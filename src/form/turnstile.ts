import { err, ok } from "../result/result";
import type { ReadonlyFormData, TurnstileResult, TurnstileVerifyOptions } from "./types";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verifies a Cloudflare Turnstile token against the siteverify API.
 *
 * @remarks
 * `options.expectedHostname`: required. Tokens minted on a different hostname cannot be replayed here.
 * @public
 */
export async function verifyTurnstile(
  formData: ReadonlyFormData,
  secretKey: string,
  options: TurnstileVerifyOptions,
  tokenField = "cf-turnstile-response",
  remoteIp?: string,
): Promise<TurnstileResult> {
  if (!options.expectedHostname) {
    return err("hostname-mismatch");
  }
  const token = formData.get(tokenField);
  if (typeof token !== "string" || token === "") {
    return err("missing-token");
  }

  const body: Record<string, string> = { secret: secretKey, response: token };
  if (remoteIp) body.remoteip = remoteIp;

  const controller = new AbortController();
  // Clamp to ≥1ms so a caller passing 0 or a negative value cannot abort the request before the
  // fetch is even dispatched (which would surface as a spurious "timeout").
  const timeoutMs = Math.max(1, options?.timeoutMs ?? 5_000);
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    return err(controller.signal.aborted ? "timeout" : "network-error");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    return err("network-error");
  }

  let data: { action?: string; cdata?: string; hostname?: string; success: boolean };
  try {
    data = (await res.json()) as { action?: string; cdata?: string; hostname?: string; success: boolean };
  } catch {
    return err("parse-error");
  }

  if (!data.success) {
    return err("verification-failed");
  }

  if (data.hostname !== options.expectedHostname) {
    return err("hostname-mismatch");
  }

  if (options.expectedAction && data.action !== options.expectedAction) {
    return err("action-mismatch");
  }

  if (options.expectedCData && data.cdata !== options.expectedCData) {
    return err("cdata-mismatch");
  }

  return ok();
}
