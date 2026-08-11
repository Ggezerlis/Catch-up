import { SYSTEM_PROMPT, buildUserMessage, RESULT_SCHEMA } from "../../src/lib/prompt";
import type { ThreadMeta } from "../../src/types";
import type { Env } from "./env";
import { AuthError, resolveUserEmail } from "./identity";
import { consume, getStatus, refund, type Entitlement } from "./db";
import { createCheckoutUrl, handleWebhook, type PurchaseKind } from "./stripe";

const MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-proxy-secret, x-goog-token",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

/** Verifies the shared secret, then resolves the caller's real identity. */
async function authenticate(request: Request, env: Env): Promise<string> {
  if (request.headers.get("x-proxy-secret") !== env.PROXY_SHARED_SECRET) {
    throw new AuthError("Unauthorized");
  }
  return resolveUserEmail(request.headers.get("x-goog-token") ?? "");
}

async function callClaude(threads: ThreadMeta[], env: Env): Promise<Response> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: RESULT_SCHEMA } },
      messages: [{ role: "user", content: buildUserMessage(threads) }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    stop_reason?: string;
    content?: Array<{ type: string; text?: string }>;
  };
  if (data.stop_reason === "refusal") {
    throw new Error("Claude declined to process this request.");
  }
  if (data.stop_reason === "max_tokens") {
    throw new Error("Claude's response was cut off. Try a shorter time window.");
  }

  const text = data.content?.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned an empty response.");

  // Already schema-validated JSON — pass through without re-serializing.
  return new Response(text, {
    status: 200,
    headers: { "content-type": "application/json", ...CORS },
  });
}

async function handleCatchUp(request: Request, env: Env): Promise<Response> {
  const email = await authenticate(request, env);

  let threads: ThreadMeta[];
  try {
    const body = (await request.json()) as { threads?: unknown };
    if (!Array.isArray(body.threads)) throw new Error("threads must be an array");
    threads = body.threads as ThreadMeta[];
  } catch {
    return json({ error: "Invalid request body — expected { threads: [...] }" }, 400);
  }

  const entitlement: Entitlement | null = await consume(env.DB, email);
  if (!entitlement) {
    const status = await getStatus(env.DB, email);
    return json({ error: "payment_required", status }, 402);
  }

  try {
    return await callClaude(threads, env);
  } catch (err) {
    // The user shouldn't pay for our failure — hand the entitlement back.
    await refund(env.DB, email, entitlement);
    return json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
}

async function handleStatus(request: Request, env: Env): Promise<Response> {
  const email = await authenticate(request, env);
  return json({ status: await getStatus(env.DB, email) });
}

async function handleCheckout(request: Request, env: Env): Promise<Response> {
  const email = await authenticate(request, env);

  let kind: PurchaseKind;
  try {
    const body = (await request.json()) as { kind?: unknown };
    if (body.kind !== "single" && body.kind !== "subscription") {
      throw new Error("bad kind");
    }
    kind = body.kind;
  } catch {
    return json({ error: 'Expected { kind: "single" | "subscription" }' }, 400);
  }

  try {
    return json({ url: await createCheckoutUrl(env, email, kind) });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** Landing page Stripe returns the user to after checkout. */
function checkoutDonePage(url: URL): Response {
  const ok = url.searchParams.get("status") === "success";
  const body = ok
    ? `<h1>Payment complete</h1>
       <p>You're all set. Close this tab and click <strong>Catch me up</strong> in the
       Catch Up extension.</p>
       <p class="muted">If it still says you're out of catch-ups, give it a few
       seconds and reopen the popup.</p>`
    : `<h1>Checkout cancelled</h1>
       <p>No payment was taken. You can close this tab.</p>`;

  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">
     <title>Catch Up</title>
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <style>
       body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
            max-width:32rem;margin:15vh auto;padding:0 1.5rem;line-height:1.6;color:#111}
       h1{font-size:1.35rem;margin-bottom:.5rem}
       .muted{color:#666;font-size:.9rem}
     </style></head><body>${body}</body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Authenticated by Stripe's signature, not our headers — must come first.
    if (request.method === "POST" && url.pathname === "/stripe/webhook") {
      return handleWebhook(request, env);
    }

    if (request.method === "GET" && url.pathname === "/checkout/done") {
      return checkoutDonePage(url);
    }

    try {
      if (request.method === "POST") {
        if (url.pathname === "/catchup") return await handleCatchUp(request, env);
        if (url.pathname === "/status") return await handleStatus(request, env);
        if (url.pathname === "/checkout") return await handleCheckout(request, env);
      }
    } catch (err) {
      if (err instanceof AuthError) return json({ error: err.message }, 401);
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }

    return json({ error: "Not found" }, 404);
  },
};
