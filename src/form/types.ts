import type { RequestContext } from "@remix-run/fetch-router";
import type { GuardResult } from "../result/result";

/** Options for `createCsrfToken`. @public */
export interface CsrfTokenOptions {
  kid?: string;
  subject?: string;
}

/** Options for `verifyCsrfToken`. @public */
export interface CsrfVerifyOptions {
  maxAgeMs?: number;
  subject?: string;
}

/** Options for `formToObject`. @public */
export interface FormToObjectOptions {
  drop?: ReadonlySet<string>;
}

/** Options for `parseFormData`. @public */
export interface ParseFormDataOptions {
  maxBytes?: number;
}

/** The read-only `FormData` view that `parseFormData` resolves to. @public */
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

/** Why a Turnstile verification did not pass. @public */
export type TurnstileFailure =
  | "action-mismatch"
  | "cdata-mismatch"
  | "hostname-mismatch"
  | "missing-token"
  | "network-error"
  | "parse-error"
  | "timeout"
  | "verification-failed";

/** Result of a Cloudflare Turnstile verification. @public */
export type TurnstileResult = GuardResult<TurnstileFailure>;

/** Constraints a Turnstile token must satisfy to pass `verifyTurnstile`. @public */
export interface TurnstileVerifyOptions {
  expectedAction?: string;
  expectedCData?: string;
  expectedHostname: string;
  tokenField?: string;
  remoteIp?: string;
  timeoutMs?: number;
}

/** Result of a CSRF token verification. @public */
export type CsrfResult = GuardResult<
  "expired" | "future-timestamp" | "invalid-format" | "invalid-signature" | "missing-token" | "path-mismatch" | "subject-mismatch" | "unknown-key"
>;

/** A key ring for CSRF secret rotation — one active signing key plus all keys valid for verification. @public */
export interface CsrfKeyRing {
  activeKeyId: string;
  keys: Record<string, CryptoKey>;
}

/** A function that resolves a CSRF secret key (or key ring) from the request context. @public */
// biome-ignore lint/suspicious/noExplicitAny: context shape varies per consumer
export type CsrfSecretResolver = (c: RequestContext<any, any>) => CryptoKey | CsrfKeyRing | Promise<CryptoKey | CsrfKeyRing>;

/** Options for the `csrfProtection` middleware. @public */
export interface CsrfProtectionOptions {
  // biome-ignore lint/suspicious/noExplicitAny: context shape varies
  secret: (context: RequestContext<any, any>) => CryptoKey | CsrfKeyRing | Promise<CryptoKey | CsrfKeyRing>;
  tokenField?: string;
  headerName?: string;
  // biome-ignore lint/suspicious/noExplicitAny: context shape varies
  subject: ((context: RequestContext<any, any>) => string | undefined) | false;
  maxBytes?: number;
}
