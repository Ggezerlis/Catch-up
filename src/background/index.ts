import type { CatchUpEvent, CatchUpItem, CatchUpRequest, CatchUpResult } from "../types";
import { getAuthToken, fetchUnreadThreads } from "../lib/gmail";
import { analyzeThreads } from "../lib/claude";

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

async function runCatchUp(
  request: CatchUpRequest,
  post: (event: CatchUpEvent) => void
): Promise<void> {
  post({ type: "status", message: "Signing in to Google…" });
  const token = await getAuthToken();

  post({ type: "status", message: "Fetching unread threads…" });
  const threads = await fetchUnreadThreads(token, request.windowDays);

  let items: CatchUpItem[] = [];
  let digest = "";
  if (threads.length > 0) {
    post({
      type: "status",
      message: `Summarizing ${threads.length} thread${threads.length === 1 ? "" : "s"} with Claude…`,
    });
    const analysis = await analyzeThreads(threads);
    digest = analysis.digest;
    const byId = new Map(threads.map((t) => [t.id, t]));
    items = analysis.threads
      .filter((a) => byId.has(a.thread_id))
      .map((a) => {
        const meta = byId.get(a.thread_id)!;
        return { ...a, subject: meta.subject, from: meta.from, date: meta.date };
      })
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  const result: CatchUpResult = {
    generatedAt: Date.now(),
    windowDays: request.windowDays,
    digest,
    items,
  };

  // Persist so the popup can show the last result even after this service
  // worker has been killed (MV3 workers die after ~30s of inactivity).
  await chrome.storage.local.set({ lastResult: result });
  post({ type: "result", result });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "catchup") return;

  port.onMessage.addListener((message: CatchUpRequest) => {
    if (message.type !== "catchup") return;
    const post = (event: CatchUpEvent) => {
      try {
        port.postMessage(event);
      } catch {
        // Popup closed mid-run; the result still lands in chrome.storage.
      }
    };
    runCatchUp(message, post).catch((err: unknown) => {
      post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    });
  });
});
