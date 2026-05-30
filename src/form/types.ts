import type { Context, Env } from "hono";

export interface ReadonlyFormData {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
  has(name: string): boolean;
  entries(): IterableIterator<[string, FormDataEntryValue]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<FormDataEntryValue>;
  forEach(
    callback: (value: FormDataEntryValue, key: string, parent: ReadonlyFormData) => void,
    thisArg?: unknown,
  ): void;
  [Symbol.iterator](): IterableIterator<[string, FormDataEntryValue]>;
}

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

export type FormFieldReader = (formData: ReadonlyFormData, field: string) => string;

/** Merge into your Hono app generic when using `csrfProtection` to type `c.get("csrfToken")`. @public */
export type CsrfVariables = {
  Variables: {
    csrfToken: string | undefined;
    mintCsrfToken: ((path: string) => Promise<string>) | undefined;
  };
};

export type CsrfResult =
  | { ok: true }
  | { ok: false; reason: "missing-token" | "invalid-format" | "expired" | "future-timestamp" | "path-mismatch" | "subject-mismatch" | "unknown-key" | "invalid-signature" };

/** A key ring for CSRF secret rotation — one active signing key plus all keys valid for verification. @public */
export interface CsrfKeyRing {
  /** kid of the key used to SIGN new tokens; must be a key in `keys`. */
  activeKeyId: string;
  /** All keys valid for VERIFICATION, indexed by kid (O(1) lookup). */
  keys: Record<string, CryptoKey>;
}

/** A function that resolves a CSRF secret key (or key ring) from the request context. @public */
export type CsrfSecretResolver<E extends Env = Env> = (c: Context<E>) => CryptoKey | CsrfKeyRing | Promise<CryptoKey | CsrfKeyRing>;
