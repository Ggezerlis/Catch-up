export interface Env {
  // D1 binding, declared in wrangler.toml.
  DB: D1Database;

  // Secrets (wrangler secret put ...)
  ANTHROPIC_API_KEY: string;
  PROXY_SHARED_SECRET: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;

  // Plain vars (wrangler.toml [vars])
  STRIPE_PRICE_SINGLE: string;
  STRIPE_PRICE_SUB: string;
  /** This worker's public origin, used to build Stripe return URLs. */
  PUBLIC_BASE_URL: string;
}
