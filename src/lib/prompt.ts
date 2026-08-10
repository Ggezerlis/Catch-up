import type { ThreadMeta } from "../types";

export const SYSTEM_PROMPT = `You are an email catch-up assistant. The user has been away from their inbox and needs to triage unread email threads quickly.

Produce two things:

1. digest: a single short paragraph (2-4 sentences) giving the user the gist of everything at a glance, the way a colleague would summarize their inbox out loud — e.g. "Alice needs the Q3 budget by Friday, IT wants you to reset your password, and there's a meeting invite for Tuesday you haven't responded to." Focus on what needs the user's attention; skip newsletters and notifications unless nothing else is going on. If there are no threads, use an empty string.

2. threads: for each thread you receive, produce:
   - summary: one or two sentences capturing what the thread is about and what (if anything) is being asked of the user.
   - priority: "high" (needs the user's action or reply soon — direct questions, deadlines, requests from colleagues or clients), "medium" (worth reading but no urgent action), or "low" (newsletters, notifications, promotions, FYIs).
   - draft_reply: for high-priority threads that warrant a reply, a short, professional draft the user can copy into Gmail. Match the sender's tone. For threads that need no reply (and all low-priority threads), use an empty string.

Return one thread entry per input thread, using each thread's exact thread_id.`;

export function buildUserMessage(threads: ThreadMeta[]): string {
  const payload = threads.map((t) => ({
    thread_id: t.id,
    subject: t.subject,
    from: t.from,
    date: t.date,
    message_count: t.messageCount,
    snippet: t.snippet,
  }));
  return `Here are the user's unread email threads as JSON:\n\n${JSON.stringify(payload, null, 2)}`;
}

/** JSON schema enforced via structured outputs (output_config.format). */
export const RESULT_SCHEMA = {
  type: "object",
  properties: {
    digest: { type: "string" },
    threads: {
      type: "array",
      items: {
        type: "object",
        properties: {
          thread_id: { type: "string" },
          summary: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          draft_reply: { type: "string" },
        },
        required: ["thread_id", "summary", "priority", "draft_reply"],
        additionalProperties: false,
      },
    },
  },
  required: ["digest", "threads"],
  additionalProperties: false,
} as const;
