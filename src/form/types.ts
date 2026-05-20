export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: "missing-token" | "verification-failed" | "network-error" | "parse-error" };

export type FormFieldReader = (formData: FormData, field: string) => string;
