import type { RequestContext } from "@remix-run/fetch-router";

export interface CsrfConfig {
  secret: string;
}

export interface TurnstileConfig {
  secretKey: string;
  siteKey: string;
}

export interface CsrfTokenOptions {
  kid?: string;
  /** Session or user identifier to bind to the token. */
  subject?: string;
}

export interface CsrfVerifyOptions {
  maxAgeMs?: number;
  subject?: string;
}

/** Maximum allowed form body size in bytes. Default: 100 KB. */
export interface ParseFormDataOptions {
  /** Maximum allowed Content-Length in bytes. Requests exceeding this are rejected with a 413 Response. Defaults to 100 KB. */
  maxBytes?: number;
}

export interface ReadonlyFormData {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
  has(name: string): boolean;
  entries(): IterableIterator<[string, FormDataEntryValue]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<FormDataEntryValue>;
  forEach(callback: (value: FormDataEntryValue, key: string, parent: ReadonlyFormData) => void, thisArg?: unknown): void;
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

export type CsrfResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "expired"
        | "future-timestamp"
        | "invalid-format"
        | "invalid-signature"
        | "missing-token"
        | "path-mismatch"
        | "subject-mismatch"
        | "unknown-key";
    };

/** A key ring for CSRF secret rotation — one active signing key plus all keys valid for verification. @public */
export interface CsrfKeyRing {
  /** kid of the key used to SIGN new tokens; must be a key in `keys`. */
  activeKeyId: string;
  /** All keys valid for VERIFICATION, indexed by kid (O(1) lookup). */
  keys: Record<string, CryptoKey>;
}

/** A function that resolves a CSRF secret key (or key ring) from the request context. @public */
// biome-ignore lint/suspicious/noExplicitAny: context shape varies per consumer
export type CsrfSecretResolver = (c: RequestContext<any, any>) => CryptoKey | CsrfKeyRing | Promise<CryptoKey | CsrfKeyRing>;
