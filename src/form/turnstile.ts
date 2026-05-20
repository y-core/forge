import type { TurnstileResult } from "./types";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  formData: FormData,
  secretKey: string,
  tokenField = "cf-turnstile-response",
  remoteIp?: string,
): Promise<TurnstileResult> {
  const token = formData.get(tokenField);
  if (typeof token !== "string" || token === "") {
    return { ok: false, reason: "missing-token" };
  }

  const body: Record<string, string> = { secret: secretKey, response: token };
  if (remoteIp) body.remoteip = remoteIp;

  let res: Response;
  try {
    res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: "network-error" };
  }

  if (!res.ok) {
    return { ok: false, reason: "network-error" };
  }

  let data: { success: boolean };
  try {
    data = (await res.json()) as { success: boolean };
  } catch {
    return { ok: false, reason: "parse-error" };
  }

  if (!data.success) {
    return { ok: false, reason: "verification-failed" };
  }

  return { ok: true };
}
