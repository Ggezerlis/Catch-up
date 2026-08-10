import type { ThreadAnalysis, ThreadMeta } from "../types";

export interface AnalyzeResult {
  digest: string;
  threads: ThreadAnalysis[];
}

/**
 * Calls the Catch Up backend proxy (worker/), which holds the Anthropic API
 * key server-side. The extension never sees or ships that key.
 */
export async function analyzeThreads(threads: ThreadMeta[]): Promise<AnalyzeResult> {
  const proxyUrl = import.meta.env.CATCHUP_PROXY_URL;
  const proxySecret = import.meta.env.CATCHUP_PROXY_SECRET;
  if (!proxyUrl) {
    throw new Error("CATCHUP_PROXY_URL is not set. Add it to .env.local and rebuild.");
  }

  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-proxy-secret": proxySecret ?? "",
    },
    body: JSON.stringify({ threads }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error ?? "";
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) {
      throw new Error(
        "Catch Up backend rejected the request — CATCHUP_PROXY_SECRET in .env.local doesn't match the worker's PROXY_SHARED_SECRET."
      );
    }
    throw new Error(detail || `Catch Up backend error ${res.status}`);
  }

  return (await res.json()) as AnalyzeResult;
}
