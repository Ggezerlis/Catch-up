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

## Monetization (next phase, not yet built)

Planned pricing:
- 3 free catch-ups/month
- After that: $0.50 for a single one-off catch-up, or $3.99/month for unlimited

Via Stripe. This needs: real per-user identity (likely the Google account
already used for OAuth), a database for usage/subscription state in the
worker (to count the 3 free/month and know who's paid), and Stripe Checkout
+ webhooks to record purchases. The current `x-proxy-secret` header is *not*
that — it's a single shared string that stops randoms from finding the URL
and burning your API budget, not per-user billing.

## Out of scope for MVP

Stripe/billing (see above — proxy is done, billing isn't), sending replies
directly, non-Gmail providers, multi-account, calendar features, Web Store
listing. Draft replies are copy-paste only.
