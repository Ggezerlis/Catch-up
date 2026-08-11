import Stripe from "stripe";
import type { Env } from "./env";
import {
  addCredits,
  claimEvent,
  emailForStripeCustomer,
  setStripeCustomer,
  setSubscription,
} from "./db";

export type PurchaseKind = "single" | "subscription";

export function stripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    // Workers have no Node http stack; these adapters use fetch/WebCrypto.
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/** Creates a hosted Checkout Session and returns the URL to open in a tab. */
export async function createCheckoutUrl(
  env: Env,
  email: string,
  kind: PurchaseKind
): Promise<string> {
  const stripe = stripeClient(env);
  const price = kind === "single" ? env.STRIPE_PRICE_SINGLE : env.STRIPE_PRICE_SUB;
  if (!price) {
    throw new Error(
      `Missing price id for "${kind}" — set STRIPE_PRICE_SINGLE / STRIPE_PRICE_SUB.`
    );
  }

  const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const session = await stripe.checkout.sessions.create({
    mode: kind === "single" ? "payment" : "subscription",
    line_items: [{ price, quantity: 1 }],
    customer_email: email,
    // Both are echoed back on the webhook so we can credit the right account.
    client_reference_id: email,
    metadata: { email, kind },
    ...(kind === "subscription"
      ? { subscription_data: { metadata: { email } } }
      : { payment_intent_data: { metadata: { email } } }),
    success_url: `${base}/checkout/done?status=success`,
    cancel_url: `${base}/checkout/done?status=cancelled`,
  });

  if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
  return session.url;
}

/**
 * Verifies and applies a Stripe webhook.
 *
 * Entitlements are granted here and nowhere else. The browser redirect after
 * checkout is not proof of payment — anyone can navigate to the success URL —
 * so the signed webhook is the only thing that moves credits.
 */
export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing stripe-signature", { status: 400 });

  const payload = await request.text();
  const stripe = stripeClient(env);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider()
    );
  } catch (err) {
    // Bad signature: either a misconfigured secret or a forged request.
    return new Response(
      `Signature verification failed: ${err instanceof Error ? err.message : "unknown"}`,
      { status: 400 }
    );
  }

  // Stripe retries on non-2xx and can double-deliver; only handle each once.
  if (!(await claimEvent(env.DB, event.id))) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const email = (session.metadata?.email ?? session.client_reference_id ?? "")
        .toLowerCase();
      if (!email) break;

      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (customerId) await setStripeCustomer(env.DB, email, customerId);

      if (session.mode === "payment") {
        if (session.payment_status === "paid") await addCredits(env.DB, email, 1);
      } else if (session.mode === "subscription") {
        // Fetch the subscription for its real period end rather than guessing.
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        let periodEnd: number | null = null;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          periodEnd = subscriptionPeriodEnd(sub);
        }
        await setSubscription(env.DB, email, "active", periodEnd, customerId);
      }
      break;
    }

    // Renewals, cancellations, and payment failures all land here.
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const email =
        (sub.metadata?.email ?? "").toLowerCase() ||
        (await emailForStripeCustomer(env.DB, customerId));
      if (!email) break;

      const active = sub.status === "active" || sub.status === "trialing";
      await setSubscription(
        env.DB,
        email,
        active ? "active" : "none",
        active ? subscriptionPeriodEnd(sub) : null,
        customerId
      );
      break;
    }

    default:
      break;
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Current period end, in unix seconds.
 *
 * Stripe moved this field from the subscription to its items; read the item
 * value first and fall back to the legacy top-level field so this keeps
 * working across API versions.
 */
function subscriptionPeriodEnd(sub: Stripe.Subscription): number | null {
  // Read both shapes dynamically: which one is typed depends on the pinned
  // API version, but either may be what the account actually returns.
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  if (typeof item?.current_period_end === "number") return item.current_period_end;
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof legacy === "number" ? legacy : null;
}
