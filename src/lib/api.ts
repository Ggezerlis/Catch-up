import type { PurchaseKind, ThreadAnalysis, ThreadMeta, UserStatus } from "../types";

export interface AnalyzeResult {
  digest: string;
  threads: ThreadAnalysis[];
}

/** Thrown when the user is out of free runs and credits. */
export class PaymentRequiredError extends Error {
  constructor(readonly status: UserStatus) {
    super("payment_required");
    this.name = "PaymentRequiredError";
  }
}

function baseUrl(): string {
  const url = import.meta.env.CATCHUP_PROXY_URL;
  if (!url) {
    throw new Error("CATCHUP_PROXY_URL is not set. Add it to .env.local and rebuild.");
  }
  // .env.local holds the full /catchup URL; derive the origin for sibling routes.
  return new URL(url).origin;
}

/**
 * The Google token is sent so the backend can verify *who* is calling by
 * asking Google — it never trusts an email supplied by the extension, since
 * that could be forged to spend someone else's credits.
 */
async function post<T>(path: string, googleToken: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-proxy-secret": import.meta.env.CATCHUP_PROXY_SECRET ?? "",
      "x-goog-token": googleToken,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 402) {
    const payload = (await res.json().catch(() => ({}))) as { status?: UserStatus };
    throw new PaymentRequiredError(
      payload.status ?? {
        email: "",
        subscribed: false,
        freeRemaining: 0,
        credits: 0,
        nextDrawsOn: null,
      }
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string })?.error ?? "";
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) {
      throw new Error(
        detail ||
          "Catch Up backend rejected the request — check CATCHUP_PROXY_SECRET in .env.local."
      );
    }
    throw new Error(detail || `Catch Up backend error ${res.status}`);
  }

  return (await res.json()) as T;
}

export function analyzeThreads(
  threads: ThreadMeta[],
  googleToken: string
): Promise<AnalyzeResult> {
  return post<AnalyzeResult>("/catchup", googleToken, { threads });
}

export async function fetchStatus(googleToken: string): Promise<UserStatus> {
  const { status } = await post<{ status: UserStatus }>("/status", googleToken, {});
  return status;
}

export async function createCheckoutUrl(
  googleToken: string,
  kind: PurchaseKind
): Promise<string> {
  const { url } = await post<{ url: string }>("/checkout", googleToken, { kind });
  return url;
}

export async function createPortalUrl(googleToken: string): Promise<string> {
  const { url } = await post<{ url: string }>("/portal", googleToken, {});
  return url;
}
