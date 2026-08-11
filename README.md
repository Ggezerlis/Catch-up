# Catch Up — Gmail catch-up Chrome extension (MVP)

Pick a time window → the extension reads your unread Gmail threads → Claude
returns a summary + priority ranking + draft replies for the high-priority ones.

## Stack

Chrome Extension Manifest V3 · Vite + React + TypeScript · @crxjs/vite-plugin ·
Tailwind CSS · `chrome.identity.getAuthToken` (Gmail readonly scope) ·
Cloudflare Worker backend proxy (`worker/`) · Anthropic Messages API
(`claude-sonnet-5`, structured JSON output).

The extension never holds an Anthropic API key. It calls a small backend
proxy (a Cloudflare Worker), which holds the key server-side and forwards the
request to Claude. See `worker/README` below for why this exists.

## Setup

### 1. Deploy the backend proxy first

The extension needs the proxy's URL before it can build correctly.

```bash
cd worker
npm install
npx wrangler login          # opens a browser, sign in / create a free Cloudflare account
npm run secret:anthropic    # paste your Anthropic API key (console.anthropic.com) when prompted
npm run secret:proxy        # paste any string you make up — this is a shared secret, not the Anthropic key
npm run deploy
```

The deploy command prints a URL like `https://catchup-proxy.<your-subdomain>.workers.dev`.
Save it — you'll need `https://catchup-proxy.<your-subdomain>.workers.dev/catchup` next.
Put that same base URL in `PUBLIC_BASE_URL` in `wrangler.toml`.

### 1b. Set up billing (database + Stripe)

**Use Stripe TEST mode throughout** — the toggle in the Stripe dashboard.
Test mode has its own keys, its own products, and its own webhooks, so none
of this touches live payments until you deliberately switch.

**Database** (stores free-uses-this-month, credits, subscription state):

```bash
npm run db:create      # prints a database_id — paste it into wrangler.toml
npm run db:migrate     # creates the tables
```

**Stripe products** — in the Stripe dashboard (test mode), create two prices
under Products, and copy each `price_...` id into `[vars]` in `wrangler.toml`:

| Product | Type | Price | Goes in |
|---|---|---|---|
| Single catch-up | One-time | €0.50 | `STRIPE_PRICE_SINGLE` |
| Catch Up unlimited | Recurring, monthly | €3.99 | `STRIPE_PRICE_SUB` |

Set currency to EUR (not USD) — Stripe enforces a minimum charge amount that
$0.50 fails to clear once converted to a EUR-settling account's currency.
Turn on **Adaptive Pricing** (dashboard search → "Adaptive Pricing") so
Stripe still shows/charges customers in their own local currency.

**Stripe keys:**

```bash
npm run secret:stripe          # Stripe dashboard -> Developers -> API keys -> TEST secret key (sk_test_...)
```

**Customer portal** — lets subscribed users cancel, update their card, or see
invoices themselves ("manage / cancel" link in the popup). Activate it once:
Stripe dashboard → search **"Customer portal"** (or Settings → Billing →
Customer portal) → **Activate test link**. No extra config needed — the
worker creates portal sessions on demand.

**Webhook** — Stripe dashboard → Developers → Webhooks → Add endpoint:

- URL: `https://catchup-proxy.<your-subdomain>.workers.dev/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`

It shows a signing secret (`whsec_...`) once — copy it, then:

```bash
npm run secret:stripe-webhook
npm run deploy                 # redeploy so the new vars/secrets take effect
```

Test card for test mode: `4242 4242 4242 4242`, any future expiry, any CVC.

### 2. Set up the extension

```bash
cd ..                # back to the repo root
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

- `CATCHUP_PROXY_URL` — the worker URL from step 1, with `/catchup` on the end
- `CATCHUP_PROXY_SECRET` — the same string you gave `secret:proxy` above
- `GOOGLE_CLIENT_ID` — Google Cloud Console → APIs & Services → Credentials →
  OAuth 2.0 Client ID of type **Chrome Extension** (not "Web application").
  The extension ID goes into that OAuth client's config. Also enable the
  **Gmail API** for the project.

### 3. Build and load

```bash
npm run build
```

Chrome → `chrome://extensions` → enable Developer mode → **Load unpacked** →
select `dist/`. After each rebuild, click the reload icon on the extension card.

For hot reload during development, run `npm run dev` instead and load `dist/`
the same way.

### 4. Try it

Pin the extension, open the popup, pick a window (24h / 3 days / 7 days),
click **Catch me up**, and grant Gmail read access when prompted.

## How it works

- **Popup** (`src/popup/`) opens a long-lived port to the service worker, shows
  progress, and renders a top-of-inbox digest plus the ranked thread list with
  expandable draft replies and Gmail deep links. Low-priority threads are
  collapsed behind a "show N more" toggle.
- **Service worker** (`src/background/`) authenticates via Chrome Identity,
  fetches unread threads from the Gmail API (`format=metadata` — cheap pass),
  and posts them to the backend proxy.
- **Backend proxy** (`worker/src/index.ts`) is a Cloudflare Worker exposing
  `POST /catchup`. It holds `ANTHROPIC_API_KEY` as a Cloudflare secret (never
  shipped to the browser), calls Claude with structured outputs
  (`output_config.format` + JSON schema — guarantees valid
  `{ digest, threads: [{ thread_id, summary, priority, draft_reply }] }`), and
  returns the result. A shared-secret header (`x-proxy-secret`) is a stopgap
  abuse guard until real per-user auth/billing exists — see below.

Note: the original spec called for `temperature: 0.3`, but `claude-sonnet-5`
rejects non-default sampling parameters (HTTP 400), so it is omitted. Output
consistency comes from the enforced JSON schema instead.

## Testing without touching Gmail/Chrome UI

`npm run test:popup` loads the built extension into a real (headless)
Chromium via Playwright and drives the popup — no Google/Anthropic
credentials needed, since it only exercises rendering and the expected
failure path when no Google account is signed in.

`npm run test:paywall` stubs the backend's billing responses to render the
three account states (allowance remaining, exhausted/paywalled, subscribed)
and checks each purchase button dispatches the right checkout kind — no
Stripe account or real payment needed.

## Monetization

Pricing:
- 3 free catch-ups per calendar month (UTC)
- After that: €0.50 for a single catch-up, or €3.99/month for unlimited
  (Stripe prices are set in EUR and use Adaptive Pricing to convert to each
  customer's local currency automatically)

How it hangs together:

- **Identity.** The extension sends its Google OAuth token to the worker,
  which asks Google whose token it is. It never trusts an email the client
  claims — otherwise anyone could forge one and mint free catch-ups or spend
  someone else's credits.
- **Entitlement order.** Active subscription → free allowance → purchased
  credit → HTTP 402 and the popup shows the paywall.
- **Atomicity.** Each spend is one conditional `UPDATE` that re-checks the
  balance in its `WHERE` clause, so two simultaneous requests can't both
  consume the same last credit.
- **Refunds.** If Claude fails after a spend, the entitlement is returned —
  an outage never costs the user a paid credit.
- **Webhooks are the only thing that grants entitlement.** The browser
  redirect after checkout proves nothing (anyone can visit the success URL);
  only Stripe's signed webhook moves credits. Event ids are recorded so
  Stripe's retries can't double-credit a single payment.
- **Subscription expiry** is enforced against the stored period end, so a
  missed cancellation webhook lapses access instead of granting it forever.
- **Self-serve cancellation.** Subscribed users get a "manage / cancel" link
  (Stripe's hosted Customer Portal) instead of a custom cancel flow — same
  webhook path (`customer.subscription.deleted`/`.updated`) revokes access.

The `x-proxy-secret` header predates this and is now just defence-in-depth
against strangers hitting the URL; per-user billing is what the above does.

## Out of scope for MVP

Sending replies directly, non-Gmail providers, multi-account, calendar
features, Chrome Web Store listing. Draft replies are copy-paste only.

Billing is built but still in Stripe **test mode** — going live means
swapping in live-mode keys, prices, and a live webhook endpoint, and is
gated on the Web Store listing anyway (nobody can pay for an extension they
can't install).
