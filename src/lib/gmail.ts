import type { ThreadMeta, WindowDays } from "../types";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
// 25 threads keeps a full run under Gmail's 250 quota units/sec
// (list = 5 units, each metadata get = 10 units) and inside Claude's context.
const MAX_THREADS = 25;

/**
 * Get an OAuth token via the Chrome Identity API.
 * Tries the cached token first; falls back to the interactive consent flow.
 */
export async function getAuthToken(): Promise<string> {
  try {
    const { token } = await chrome.identity.getAuthToken({ interactive: false });
    if (token) return token;
  } catch {
    // No cached token — fall through to interactive.
  }
  try {
    const { token } = await chrome.identity.getAuthToken({ interactive: true });
    if (token) return token;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Google sign-in failed (${detail}). Check that GOOGLE_CLIENT_ID in .env.local matches a 'Chrome Extension' OAuth client for this extension ID, and that this Chrome profile is signed in to a Google account.`
    );
  }
  throw new Error(
    "Google sign-in failed. Check that GOOGLE_CLIENT_ID in .env.local matches a 'Chrome Extension' OAuth client for this extension ID."
  );
}

async function gmailFetch(path: string, token: string): Promise<any> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    // Cached token was revoked/expired — drop it so the next run re-auths.
    await chrome.identity.removeCachedAuthToken({ token });
    throw new Error("Gmail session expired. Click 'Catch me up' again to re-authenticate.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail API error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function header(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** List unread threads in the window and fetch cheap metadata for each. */
export async function fetchUnreadThreads(
  token: string,
  windowDays: WindowDays
): Promise<ThreadMeta[]> {
  const q = encodeURIComponent(`is:unread newer_than:${windowDays}d`);
  const list = await gmailFetch(`/threads?q=${q}&maxResults=${MAX_THREADS}`, token);
  const threadRefs: Array<{ id: string }> = list.threads ?? [];
  if (threadRefs.length === 0) return [];

  const metas: ThreadMeta[] = [];
  // Chunks of 10 stay well under the 250 quota units/user/sec limit.
  for (let i = 0; i < threadRefs.length; i += 10) {
    const chunk = threadRefs.slice(i, i + 10);
    const results = await Promise.all(
      chunk.map((t) =>
        gmailFetch(
          `/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          token
        )
      )
    );
    for (const thread of results) {
      const messages: any[] = thread.messages ?? [];
      if (messages.length === 0) continue;
      const first = messages[0];
      const last = messages[messages.length - 1];
      metas.push({
        id: thread.id,
        subject: header(first.payload?.headers ?? [], "Subject") || "(no subject)",
        from: header(last.payload?.headers ?? [], "From"),
        date: header(last.payload?.headers ?? [], "Date"),
        snippet: last.snippet ?? "",
        messageCount: messages.length,
      });
    }
  }
  return metas;
}
