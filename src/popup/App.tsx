import { useEffect, useState } from "react";
import type {
  AppResponse,
  CatchUpEvent,
  CatchUpItem,
  CatchUpResult,
  Priority,
  PurchaseKind,
  UserStatus,
  WindowDays,
} from "../types";

const PRIVACY_URL = "https://ggezerlis.github.io/catch-up/privacy-policy.html";
const TERMS_URL = "https://ggezerlis.github.io/catch-up/terms-of-service.html";

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
  const [account, setAccount] = useState<UserStatus | null>(null);
  const [paywalled, setPaywalled] = useState(false);

  const refreshAccount = () => {
    chrome.runtime.sendMessage({ type: "getStatus" }, (res: AppResponse) => {
      // Ignore failures here — the status line is informational, and any real
      // problem will surface with a proper message on "Catch me up".
      if (res?.ok && "status" in res) {
        setAccount(res.status);
        setPaywalled(res.status.nextDrawsOn === null);
      }
    });
  };

  useEffect(() => {
    chrome.storage.local.get("lastResult").then(({ lastResult }) => {
      if (lastResult) setResult(lastResult as CatchUpResult);
    });
    refreshAccount();
  }, []);

  const catchMeUp = () => {
    setLoading(true);
    setError("");
    setPaywalled(false);
    setStatus("Starting…");

    const port = chrome.runtime.connect({ name: "catchup" });
    port.onMessage.addListener((event: CatchUpEvent) => {
      if (event.type === "status") {
        setStatus(event.message);
      } else if (event.type === "result") {
        setResult(event.result);
        setLoading(false);
        refreshAccount();
        port.disconnect();
      } else if (event.type === "paywall") {
        setAccount(event.status);
        setPaywalled(true);
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
        disabled={loading || paywalled}
        className="w-full rounded-md bg-blue-600 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {loading ? "Working…" : "Catch me up"}
      </button>

      {account && !paywalled && <AllowanceLine account={account} />}
      <div className="mb-3" />

      {loading && (
        <div className="mb-3 flex items-center gap-2 text-gray-500">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          {status}
        </div>
      )}

      {paywalled && <Paywall onPurchased={refreshAccount} />}

      {error && (
        <div className="mb-3 rounded-md bg-red-50 p-3 text-red-700">{error}</div>
      )}

      {!loading && result && (
        <ResultList result={result} />
      )}

      <footer className="mt-4 flex justify-center gap-3 border-t border-gray-100 pt-3 text-[11px] text-gray-400">
        <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="hover:underline">
          Privacy
        </a>
        <span aria-hidden="true">·</span>
        <a href={TERMS_URL} target="_blank" rel="noreferrer" className="hover:underline">
          Terms
        </a>
      </footer>
    </div>
  );
}

function AllowanceLine({ account }: { account: UserStatus }) {
  if (account.subscribed) {
    return (
      <p className="mt-1.5 text-center text-xs text-gray-400">
        Unlimited · subscribed ·{" "}
        <ManageSubscriptionLink />
      </p>
    );
  }
  const parts: string[] = [];
  if (account.freeRemaining > 0) parts.push(`${account.freeRemaining} free left this month`);
  if (account.credits > 0) {
    parts.push(`${account.credits} credit${account.credits === 1 ? "" : "s"}`);
  }
  return (
    <p className="mt-1.5 text-center text-xs text-gray-400">
      {parts.join(" · ") || "No catch-ups left"}
    </p>
  );
}

function ManageSubscriptionLink() {
  const [busy, setBusy] = useState(false);

  const openPortal = () => {
    setBusy(true);
    chrome.runtime.sendMessage({ type: "openPortal" }, (res: AppResponse) => {
      setBusy(false);
      if (!res?.ok) {
        // Rare (e.g. Stripe misconfigured); no dedicated UI for this edge case.
        alert(res?.error ?? "Could not open the billing portal.");
      }
    });
  };

  return (
    <button onClick={openPortal} disabled={busy} className="underline hover:text-gray-600">
      {busy ? "Opening…" : "manage / cancel"}
    </button>
  );
}

function Paywall({ onPurchased }: { onPurchased: () => void }) {
  const [busy, setBusy] = useState<PurchaseKind | null>(null);
  const [err, setErr] = useState("");

  const buy = (kind: PurchaseKind) => {
    setBusy(kind);
    setErr("");
    chrome.runtime.sendMessage({ type: "startCheckout", kind }, (res: AppResponse) => {
      setBusy(null);
      if (!res?.ok) {
        setErr(res?.error ?? "Could not start checkout.");
        return;
      }
      // Checkout opens in a new tab; Stripe's webhook credits the account a
      // moment later, so re-check rather than assuming it already landed.
      setTimeout(onPurchased, 3000);
    });
  };

  return (
    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3">
      <p className="mb-2 font-medium text-amber-900">You've used your 3 free catch-ups</p>
      <p className="mb-3 text-xs text-amber-800">
        Grab a single one, or go unlimited for the month.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => buy("single")}
          disabled={busy !== null}
          className="flex-1 rounded-md border border-amber-300 bg-white py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
        >
          {busy === "single" ? "Opening…" : "1 catch-up · $0.50"}
        </button>
        <button
          onClick={() => buy("subscription")}
          disabled={busy !== null}
          className="flex-1 rounded-md bg-amber-600 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {busy === "subscription" ? "Opening…" : "Unlimited · $3.99/mo"}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
      <p className="mt-2 text-center text-[11px] text-amber-700">
        Paid in a new tab. Come back here when you're done.
      </p>
    </div>
  );
}

function ResultList({ result }: { result: CatchUpResult }) {
  const [showLowPriority, setShowLowPriority] = useState(false);

  if (result.items.length === 0) {
    return (
      <div className="rounded-md bg-green-50 p-4 text-center text-green-700">
        You're all caught up — no unread threads in the last{" "}
        {result.windowDays === 1 ? "24 hours" : `${result.windowDays} days`}. 🎉
      </div>
    );
  }

  const visible = result.items.filter((i) => i.priority !== "low");
  const hidden = result.items.filter((i) => i.priority === "low");

  return (
    <div>
      {result.digest && (
        <div className="mb-3 rounded-md border border-blue-100 bg-blue-50 p-3 text-blue-900">
          {result.digest}
        </div>
      )}
      <p className="mb-2 text-xs text-gray-400">
        {result.items.length} thread{result.items.length === 1 ? "" : "s"} ·{" "}
        {new Date(result.generatedAt).toLocaleTimeString()}
      </p>
      <ul className="space-y-2">
        {visible.map((item) => (
          <ThreadCard key={item.thread_id} item={item} />
        ))}
      </ul>

      {hidden.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowLowPriority(!showLowPriority)}
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            {showLowPriority
              ? "Hide low-priority threads"
              : `Show ${hidden.length} more (low priority)`}
          </button>
          {showLowPriority && (
            <ul className="mt-2 space-y-2">
              {hidden.map((item) => (
                <ThreadCard key={item.thread_id} item={item} />
              ))}
            </ul>
          )}
        </div>
      )}
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
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <a
          href={`https://mail.google.com/mail/u/0/#all/${item.thread_id}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          Open in Gmail ↗
        </a>
        {item.draft_reply && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            {expanded ? "Hide draft reply" : "Show draft reply"}
          </button>
        )}
      </div>
      {expanded && item.draft_reply && (
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
    </li>
  );
}
