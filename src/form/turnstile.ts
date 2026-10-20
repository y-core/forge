import { admitsTestingSecret } from "#relax/turnstile";

import { err, ok } from "../result/result";
import { TURNSTILE_FIELD_DEFAULT } from "./constants";
import type { ReadonlyFormData, RelaxTestingSecret, TurnstileResult, TurnstileVerifyOptions } from "./types";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Verifies a Cloudflare Turnstile token against the siteverify API. @public */
export async function verifyTurnstile(formData: ReadonlyFormData, secretKey: string, options: TurnstileVerifyOptions): Promise<TurnstileResult> {
  return verifyTurnstileWith(formData, secretKey, options, admitsTestingSecret);
}

/** `verifyTurnstile` with the testing-secret relaxation passed in. @internal */
export async function verifyTurnstileWith(
  formData: ReadonlyFormData,
  secretKey: string,
  options: TurnstileVerifyOptions,
  admitsTesting: RelaxTestingSecret,
): Promise<TurnstileResult> {
  if (!options.expectedHostname) {
    return err("hostname-mismatch");
  }
  const token = formData.get(options.tokenField ?? TURNSTILE_FIELD_DEFAULT);
  if (typeof token !== "string" || token === "") {
    return err("missing-token");
  }

  const body: Record<string, string> = { secret: secretKey, response: token };
  if (options.remoteIp) body.remoteip = options.remoteIp;

  // Clamped to >=1ms: a 0 would abort before the fetch dispatched and surface as a spurious "timeout".
  const timeoutMs = Math.max(1, options?.timeoutMs ?? 5_000);
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;

  let res: Response;
  try {
    res = await fetch(VERIFY_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (thrown) {
    if (options.signal?.aborted) throw thrown;
    return err(deadline.aborted ? "timeout" : "network-error");
  }

  if (!res.ok) {
    return err("network-error");
  }

  let data: { action?: string; cdata?: string; hostname?: string; success: boolean };
  try {
    data = (await res.json()) as { action?: string; cdata?: string; hostname?: string; success: boolean };
  } catch (thrown) {
    if (options.signal?.aborted) throw thrown;
    return err(deadline.aborted ? "timeout" : "parse-error");
  }

  if (!data.success) {
    return err("verification-failed");
  }

  if (admitsTesting(secretKey)) return ok();

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
