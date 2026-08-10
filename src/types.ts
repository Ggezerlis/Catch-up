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

/** Messages sent from popup to the service worker over the port. */
export interface CatchUpRequest {
  type: "catchup";
  windowDays: WindowDays;
}

/** Messages sent from the service worker back to the popup. */
export type CatchUpEvent =
  | { type: "status"; message: string }
  | { type: "result"; result: CatchUpResult }
  | { type: "error"; message: string };
