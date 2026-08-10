import type { ThreadAnalysis, ThreadMeta } from "../types";
import { SYSTEM_PROMPT, buildUserMessage, RESULT_SCHEMA } from "./prompt";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

/**
 * Direct browser call — MVP local dev only. Before shipping to the Chrome
 * Web Store this MUST be replaced by a POST to a backend proxy (Cloudflare
 * Worker) so the API key never ships inside the extension bundle.
 */
export interface AnalyzeResult {
  digest: string;
  threads: ThreadAnalysis[];
}

export async function analyzeThreads(threads: ThreadMeta[]): Promise<AnalyzeResult> {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local and rebuild.");
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      // No temperature: claude-sonnet-5 rejects non-default sampling params
      // with a 400. Consistency comes from the enforced JSON schema below.
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: RESULT_SCHEMA } },
      messages: [{ role: "user", content: buildUserMessage(threads) }],
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message ?? "";
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) throw new Error("Claude API key is invalid. Check ANTHROPIC_API_KEY in .env.local.");
    if (res.status === 429) throw new Error("Claude API rate limit hit. Wait a moment and try again.");
    throw new Error(`Claude API error ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  const data = await res.json();

  if (data.stop_reason === "refusal") {
    throw new Error("Claude declined to process this request.");
  }
  if (data.stop_reason === "max_tokens") {
    throw new Error("Claude's response was cut off. Try a shorter time window.");
  }

  const text = data.content?.find((b: { type: string }) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned an empty response.");

  return JSON.parse(text) as AnalyzeResult;
}
