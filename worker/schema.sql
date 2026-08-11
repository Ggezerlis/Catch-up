-- Catch Up billing state. Applied with:
--   npx wrangler d1 execute catchup-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  -- Purchased one-off catch-ups, not yet spent.
  credits INTEGER NOT NULL DEFAULT 0,
  -- Free catch-ups consumed within free_period.
  free_used INTEGER NOT NULL DEFAULT 0,
  -- UTC 'YYYY-MM' the free_used counter belongs to; rolls over on change.
  free_period TEXT NOT NULL DEFAULT '',
  -- 'none' | 'active'. Set by Stripe webhooks, never by the client.
  subscription_status TEXT NOT NULL DEFAULT 'none',
  -- Unix seconds. Access is denied once past this even if status is stale.
  subscription_period_end INTEGER,
  stripe_customer_id TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer
  ON users (stripe_customer_id);

-- Stripe retries webhooks and can deliver the same event more than once;
-- this makes handling idempotent so a retry can't grant a second credit.
CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);
