export type WindowDays = 1 | 3 | 7;

export type Priority = "high" | "medium" | "low";

/** Lightweight per-thread metadata pulled from the Gmail API. */
export interface ThreadMeta {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  messageCount: number;
}

/** Claude's analysis of a single thread. */
export interface ThreadAnalysis {
  thread_id: string;
  summary: string;
  priority: Priority;
  /** Empty string when no reply is needed (typically low priority). */
  draft_reply: string;
}

/** A thread's metadata joined with its analysis, for display. */
export interface CatchUpItem extends ThreadAnalysis {
  subject: string;
  from: string;
  date: string;
}

export interface CatchUpResult {
  generatedAt: number;
  windowDays: WindowDays;
  /** One-paragraph "here's what happened" overview. Empty when items is empty. */
  digest: string;
  items: CatchUpItem[];
}

/** What the next catch-up would draw on; null means payment is required. */
export type Entitlement = "subscription" | "free" | "credit";

/** The user's billing standing, as reported by the backend. */
export interface UserStatus {
  email: string;
  subscribed: boolean;
  freeRemaining: number;
  credits: number;
  nextDrawsOn: Entitlement | null;
}

export type PurchaseKind = "single" | "subscription";

/** Messages sent from popup to the service worker over the port. */
export interface CatchUpRequest {
  type: "catchup";
  windowDays: WindowDays;
}

/** Messages sent from the service worker back to the popup. */
export type CatchUpEvent =
  | { type: "status"; message: string }
  | { type: "result"; result: CatchUpResult }
  | { type: "paywall"; status: UserStatus }
  | { type: "error"; message: string };

/** One-shot messages (chrome.runtime.sendMessage), outside the catch-up port. */
export type AppMessage =
  | { type: "getStatus" }
  | { type: "startCheckout"; kind: PurchaseKind }
  | { type: "openPortal" };

export type AppResponse =
  | { ok: true; status: UserStatus }
  | { ok: true }
  | { ok: false; error: string };
