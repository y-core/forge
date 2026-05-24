export type TurnstileResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "action-mismatch"
        | "cdata-mismatch"
        | "hostname-mismatch"
        | "missing-token"
        | "network-error"
        | "parse-error"
        | "timeout"
        | "verification-failed";
    };

export interface TurnstileVerifyOptions {
  expectedAction?: string;
  expectedCData?: string;
  expectedHostname?: string;
  timeoutMs?: number;
}

export type FormFieldReader = (formData: FormData, field: string) => string;
