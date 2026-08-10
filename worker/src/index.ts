import { SYSTEM_PROMPT, buildUserMessage, RESULT_SCHEMA } from "../../src/lib/prompt";
import type { ThreadMeta } from "../../src/types";

export interface Env {
  ANTHROPIC_API_KEY: string;
  PROXY_SHARED_SECRET: string;
}

const MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // Chrome extensions with this worker's origin in host_permissions
      // bypass CORS entirely, but keep this permissive for local curl/testing.
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, x-proxy-secret",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return json(null, 204);

    if (request.method !== "POST" || new URL(request.url).pathname !== "/catchup") {
      return json({ error: "Not found" }, 404);
    }

    // Stopgap abuse guard until real per-user auth/billing exists. Anyone
    // with this string can burn your Anthropic budget — rotate it if leaked.
    if (request.headers.get("x-proxy-secret") !== env.PROXY_SHARED_SECRET) {
      return json({ error: "Unauthorized" }, 401);
    }

    let threads: ThreadMeta[];
    try {
      const body = (await request.json()) as { threads?: unknown };
      if (!Array.isArray(body.threads)) throw new Error("threads must be an array");
      threads = body.threads as ThreadMeta[];
    } catch {
      return json({ error: "Invalid request body — expected { threads: [...] }" }, 400);
    }

    const anthropicRes = await fetch(ANTHROPIC_URL, {
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

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text().catch(() => "");
      return json(
        { error: `Claude API error ${anthropicRes.status}: ${detail.slice(0, 300)}` },
        502
      );
    }

    const data = (await anthropicRes.json()) as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string }>;
    };

    if (data.stop_reason === "refusal") {
      return json({ error: "Claude declined to process this request." }, 502);
    }
    if (data.stop_reason === "max_tokens") {
      return json({ error: "Claude's response was cut off. Try a shorter time window." }, 502);
    }

    const text = data.content?.find((b) => b.type === "text")?.text;
    if (!text) {
      return json({ error: "Claude returned an empty response." }, 502);
    }

    // text is already schema-validated JSON matching { digest, threads } —
    // pass it straight through rather than re-parsing and re-serializing.
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      },
    });
  },
};
