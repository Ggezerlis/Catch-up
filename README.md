# Catch Up — Gmail catch-up Chrome extension (MVP)

Pick a time window → the extension reads your unread Gmail threads → Claude
returns a summary + priority ranking + draft replies for the high-priority ones.

## Stack

Chrome Extension Manifest V3 · Vite + React + TypeScript · @crxjs/vite-plugin ·
Tailwind CSS · `chrome.identity.getAuthToken` (Gmail readonly scope) ·
Anthropic Messages API (`claude-sonnet-5`, structured JSON output).

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create `.env.local`** (never commit it):

   ```bash
   cp .env.example .env.local
   ```

   - `ANTHROPIC_API_KEY` — from console.anthropic.com
   - `GOOGLE_CLIENT_ID` — Google Cloud Console → APIs & Services → Credentials →
     OAuth 2.0 Client ID of type **Chrome Extension** (not "Web application").
     The extension ID goes into that OAuth client's config. Also enable the
     **Gmail API** for the project.

3. **Build and load**

   ```bash
   npm run build
   ```

   Chrome → `chrome://extensions` → enable Developer mode → **Load unpacked** →
   select `dist/`. After each rebuild, click the reload icon on the extension card.

   For hot reload during development, run `npm run dev` instead and load `dist/`
   the same way.

4. Pin the extension, open the popup, pick a window (24h / 3 days / 7 days),
   click **Catch me up**, and grant Gmail read access when prompted.

## How it works

- **Popup** (`src/popup/`) opens a long-lived port to the service worker, shows
  progress, and renders the ranked result list with expandable draft replies.
- **Service worker** (`src/background/`) authenticates via Chrome Identity,
  fetches unread threads from the Gmail API (`format=metadata` — cheap pass),
  sends them to Claude, and persists the result in `chrome.storage.local`
  (MV3 workers die after ~30s idle, so nothing is kept in memory).
- **Claude call** (`src/lib/claude.ts`) uses structured outputs
  (`output_config.format` with a JSON schema), so the response is guaranteed
  valid JSON: `{ threads: [{ thread_id, summary, priority, draft_reply }] }`.

Note: the spec called for `temperature: 0.3`, but `claude-sonnet-5` rejects
non-default sampling parameters (HTTP 400), so it is omitted. Output
consistency comes from the enforced JSON schema instead.

## ⚠️ Security — before shipping

The direct browser call to the Claude API (with the
`anthropic-dangerous-direct-browser-access` header) is for **local dev only**.
Chrome extensions are fully inspectable — an API key in the bundle will be
scraped. Before any Chrome Web Store upload, proxy the call through a
lightweight backend (Cloudflare Worker with a single `POST /catchup` endpoint
that accepts `{ threads: [...] }` and calls Claude server-side).

## Out of scope for MVP

Billing/Stripe, sending replies directly, non-Gmail providers, multi-account,
calendar features, Web Store listing. Draft replies are copy-paste only.
