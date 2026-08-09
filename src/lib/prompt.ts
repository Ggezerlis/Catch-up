import type { ThreadMeta } from "../types";

export const SYSTEM_PROMPT = `You are an email catch-up assistant. The user has been away from their inbox and needs to triage unread email threads quickly.

For each thread you receive, produce:
- summary: one or two sentences capturing what the thread is about and what (if anything) is being asked of the user.
- priority: "high" (needs the user's action or reply soon — direct questions, deadlines, requests from colleagues or clients), "medium" (worth reading but no urgent action), or "low" (newsletters, notifications, promotions, FYIs).
- draft_reply: for high-priority threads that warrant a reply, a short, professional draft the user can copy into Gmail. Match the sender's tone. For threads that need no reply (and all low-priority threads), use an empty string.

Return one entry per input thread, using each thread's exact thread_id.`;

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
  required: ["threads"],
  additionalProperties: false,
} as const;
