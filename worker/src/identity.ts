/**
 * Resolves a Google OAuth access token to a verified email address.
 *
 * The extension must never simply *tell* us who it is — a forged email would
 * let anyone mint unlimited free catch-ups or spend someone else's credits.
 * Instead the extension sends its Google access token and we ask Google who
 * it belongs to. An invalid or expired token fails here and the request is
 * rejected.
 *
 * We use the Gmail profile endpoint rather than Google's userinfo endpoint
 * because it works with the `gmail.readonly` scope the extension already
 * holds — no extra consent screen for the user.
 */
const GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

export class AuthError extends Error {}

export async function resolveUserEmail(token: string): Promise<string> {
  if (!token) throw new AuthError("Missing Google access token.");

  const res = await fetch(GMAIL_PROFILE_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 || res.status === 403) {
    throw new AuthError("Google sign-in expired. Reopen Catch Up to sign in again.");
  }
  if (!res.ok) {
    throw new AuthError(`Could not verify Google identity (HTTP ${res.status}).`);
  }

  const profile = (await res.json()) as { emailAddress?: string };
  if (!profile.emailAddress) {
    throw new AuthError("Google did not return an email address for this token.");
  }
  return profile.emailAddress.toLowerCase();
}
