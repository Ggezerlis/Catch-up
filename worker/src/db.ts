export const FREE_PER_MONTH = 3;

export type Entitlement = "subscription" | "free" | "credit";

export interface UserStatus {
  email: string;
  subscribed: boolean;
  freeRemaining: number;
  credits: number;
  /** What the next catch-up would draw on, or null if payment is required. */
  nextDrawsOn: Entitlement | null;
}

interface UserRow {
  email: string;
  credits: number;
  free_used: number;
  free_period: string;
  subscription_status: string;
  subscription_period_end: number | null;
  stripe_customer_id: string | null;
}

/** UTC 'YYYY-MM'. The free allowance resets when this string changes. */
export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isSubscriptionActive(row: UserRow, nowSec: number): boolean {
  // Require both the status flag and an unexpired period. If a
  // `subscription.deleted` webhook is ever missed, access still lapses on
  // its own rather than granting unlimited use forever.
  return (
    row.subscription_status === "active" &&
    row.subscription_period_end !== null &&
    row.subscription_period_end > nowSec
  );
}

/** Creates the row if absent and rolls the free counter into this month. */
async function loadUser(db: D1Database, email: string): Promise<UserRow> {
  const period = currentPeriod();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO users (email, free_period, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(email) DO NOTHING`
    )
    .bind(email, period, now)
    .run();

  await db
    .prepare(
      `UPDATE users SET free_used = 0, free_period = ?, updated_at = ?
       WHERE email = ? AND free_period <> ?`
    )
    .bind(period, now, email, period)
    .run();

  const row = await db
    .prepare(`SELECT * FROM users WHERE email = ?`)
    .bind(email)
    .first<UserRow>();
  if (!row) throw new Error("Failed to load user record.");
  return row;
}

export async function getStatus(db: D1Database, email: string): Promise<UserStatus> {
  const row = await loadUser(db, email);
  const nowSec = Math.floor(Date.now() / 1000);
  const subscribed = isSubscriptionActive(row, nowSec);
  const freeRemaining = Math.max(0, FREE_PER_MONTH - row.free_used);

  return {
    email,
    subscribed,
    freeRemaining,
    credits: row.credits,
    nextDrawsOn: subscribed
      ? "subscription"
      : freeRemaining > 0
        ? "free"
        : row.credits > 0
          ? "credit"
          : null,
  };
}

/**
 * Atomically claims one catch-up. Returns which entitlement was spent, or
 * null when the user must pay.
 *
 * Each branch is a single conditional UPDATE whose WHERE clause re-checks the
 * balance, so two concurrent requests can't both consume the same last free
 * use or credit — at most one of them sees `changes === 1`.
 */
export async function consume(
  db: D1Database,
  email: string
): Promise<Entitlement | null> {
  const row = await loadUser(db, email);
  const nowSec = Math.floor(Date.now() / 1000);
  const period = currentPeriod();

  if (isSubscriptionActive(row, nowSec)) return "subscription";

  const free = await db
    .prepare(
      `UPDATE users SET free_used = free_used + 1, updated_at = ?
       WHERE email = ? AND free_period = ? AND free_used < ?`
    )
    .bind(nowSec, email, period, FREE_PER_MONTH)
    .run();
  if (free.meta.changes === 1) return "free";

  const credit = await db
    .prepare(
      `UPDATE users SET credits = credits - 1, updated_at = ?
       WHERE email = ? AND credits > 0`
    )
    .bind(nowSec, email)
    .run();
  if (credit.meta.changes === 1) return "credit";

  return null;
}

/**
 * Gives back an entitlement spent on a request that then failed, so a Claude
 * outage doesn't cost the user a paid credit or one of their free runs.
 */
export async function refund(
  db: D1Database,
  email: string,
  entitlement: Entitlement
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (entitlement === "free") {
    await db
      .prepare(
        `UPDATE users SET free_used = MAX(0, free_used - 1), updated_at = ?
         WHERE email = ? AND free_period = ?`
      )
      .bind(nowSec, email, currentPeriod())
      .run();
  } else if (entitlement === "credit") {
    await db
      .prepare(`UPDATE users SET credits = credits + 1, updated_at = ? WHERE email = ?`)
      .bind(nowSec, email)
      .run();
  }
  // "subscription" spends nothing, so there is nothing to give back.
}

export async function addCredits(
  db: D1Database,
  email: string,
  count: number
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO users (email, credits, free_period, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET credits = credits + ?, updated_at = ?`
    )
    .bind(email, count, currentPeriod(), nowSec, count, nowSec)
    .run();
}

export async function setSubscription(
  db: D1Database,
  email: string,
  status: "active" | "none",
  periodEnd: number | null,
  stripeCustomerId?: string
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO users (email, subscription_status, subscription_period_end, stripe_customer_id, free_period, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         subscription_status = ?,
         subscription_period_end = ?,
         stripe_customer_id = COALESCE(?, stripe_customer_id),
         updated_at = ?`
    )
    .bind(
      email, status, periodEnd, stripeCustomerId ?? null, currentPeriod(), nowSec,
      status, periodEnd, stripeCustomerId ?? null, nowSec
    )
    .run();
}

export async function setStripeCustomer(
  db: D1Database,
  email: string,
  customerId: string
): Promise<void> {
  await db
    .prepare(`UPDATE users SET stripe_customer_id = ?, updated_at = ? WHERE email = ?`)
    .bind(customerId, Math.floor(Date.now() / 1000), email)
    .run();
}

export async function emailForStripeCustomer(
  db: D1Database,
  customerId: string
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT email FROM users WHERE stripe_customer_id = ?`)
    .bind(customerId)
    .first<{ email: string }>();
  return row?.email ?? null;
}

/**
 * Records a Stripe event id, returning false if it was already handled.
 * Stripe retries deliveries, so without this a retry could grant a second
 * credit for a single payment.
 */
export async function claimEvent(db: D1Database, eventId: string): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO processed_events (event_id, processed_at) VALUES (?, ?)
       ON CONFLICT(event_id) DO NOTHING`
    )
    .bind(eventId, Math.floor(Date.now() / 1000))
    .run();
  return res.meta.changes === 1;
}
