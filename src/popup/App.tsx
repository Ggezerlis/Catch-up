import { useEffect, useState } from "react";
import type { CatchUpEvent, CatchUpItem, CatchUpResult, Priority, WindowDays } from "../types";

const WINDOWS: Array<{ days: WindowDays; label: string }> = [
  { days: 1, label: "24h" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
];

const PRIORITY_STYLES: Record<Priority, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-gray-100 text-gray-600",
};

export default function App() {
  const [windowDays, setWindowDays] = useState<WindowDays>(1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<CatchUpResult | null>(null);

  useEffect(() => {
    chrome.storage.local.get("lastResult").then(({ lastResult }) => {
      if (lastResult) setResult(lastResult as CatchUpResult);
    });
  }, []);

  const catchMeUp = () => {
    setLoading(true);
    setError("");
    setStatus("Starting…");

    const port = chrome.runtime.connect({ name: "catchup" });
    port.onMessage.addListener((event: CatchUpEvent) => {
      if (event.type === "status") {
        setStatus(event.message);
      } else if (event.type === "result") {
        setResult(event.result);
        setLoading(false);
        port.disconnect();
      } else if (event.type === "error") {
        setError(event.message);
        setLoading(false);
        port.disconnect();
      }
    });
    port.postMessage({ type: "catchup", windowDays });
  };

  return (
    <div className="p-4 font-sans text-sm text-gray-900">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-base font-semibold">Catch Up</h1>
        <div className="flex rounded-md border border-gray-200 p-0.5">
          {WINDOWS.map(({ days, label }) => (
            <button
              key={days}
              onClick={() => setWindowDays(days)}
              disabled={loading}
              className={`rounded px-2 py-1 text-xs ${
                windowDays === days ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={catchMeUp}
        disabled={loading}
        className="mb-3 w-full rounded-md bg-blue-600 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {loading ? "Working…" : "Catch me up"}
      </button>

      {loading && (
        <div className="mb-3 flex items-center gap-2 text-gray-500">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          {status}
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-md bg-red-50 p-3 text-red-700">{error}</div>
      )}

      {!loading && result && (
        <ResultList result={result} />
      )}
    </div>
  );
}

function ResultList({ result }: { result: CatchUpResult }) {
  if (result.items.length === 0) {
    return (
      <div className="rounded-md bg-green-50 p-4 text-center text-green-700">
        You're all caught up — no unread threads in the last{" "}
        {result.windowDays === 1 ? "24 hours" : `${result.windowDays} days`}. 🎉
      </div>
    );
  }
  return (
    <div>
      <p className="mb-2 text-xs text-gray-400">
        {result.items.length} thread{result.items.length === 1 ? "" : "s"} ·{" "}
        {new Date(result.generatedAt).toLocaleTimeString()}
      </p>
      <ul className="space-y-2">
        {result.items.map((item) => (
          <ThreadCard key={item.thread_id} item={item} />
        ))}
      </ul>
    </div>
  );
}

function ThreadCard({ item }: { item: CatchUpItem }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyDraft = async () => {
    await navigator.clipboard.writeText(item.draft_reply);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li className="rounded-md border border-gray-200 p-3">
      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="font-medium leading-snug">{item.subject}</span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_STYLES[item.priority]}`}
        >
          {item.priority}
        </span>
      </div>
      <p className="mb-1 truncate text-xs text-gray-400">{item.from}</p>
      <p className="text-gray-700">{item.summary}</p>
      {item.draft_reply && (
        <div className="mt-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            {expanded ? "Hide draft reply" : "Show draft reply"}
          </button>
          {expanded && (
            <div className="mt-1 rounded bg-gray-50 p-2">
              <p className="whitespace-pre-wrap text-xs text-gray-700">{item.draft_reply}</p>
              <button
                onClick={copyDraft}
                className="mt-1.5 text-xs font-medium text-blue-600 hover:underline"
              >
                {copied ? "Copied!" : "Copy to clipboard"}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
