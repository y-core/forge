import type { RequestContext } from "@remix-run/fetch-router";

import type { Refusal } from "../context/types";
import type { KeyRingResolver } from "../crypto/keyring/types";
import type { GuardResult } from "../result/types";

/** Options for `createCsrfToken`. @public */
export interface CsrfTokenOptions {
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
  /** Cancellation from the caller — an abort on it rejects rather than resolving to a `Result`. */
  signal?: AbortSignal;
}

/** Why `verifyCsrfToken` refused a token. @public */
export type CsrfFailure = Exclude<CsrfRefusal, "unbound-subject">;

/** Result of a CSRF token verification. @public */
export type CsrfResult = GuardResult<CsrfFailure>;

/** Why the CSRF policy refused a mutation: a token failure, or a `subject` resolver that returned nothing to bind to. @public */
export type CsrfRefusal = Extract<Refusal, { guard: "csrf"; status: 403 }>["reason"];

/** Options for the app's CSRF policy, as `MiddlewareCsrfPolicy` and `csrfMintStage` take them. @public */
export interface CsrfPolicyOptions<Bindings = Record<string, unknown>> {
  ring: KeyRingResolver<Bindings>;
  tokenField?: string;
  headerName?: string;
  /** `"session"` binds every token to the chain session's id, resolved by `applyMiddlewareChain`; `false` mints path-only tokens. */
  // oxlint-disable-next-line typescript/no-explicit-any -- context shape varies
  subject: "session" | ((context: RequestContext<any, any>) => string | undefined) | false;
  maxBytes?: number;
  /** How long a token verifies, in milliseconds; defaults to `CSRF_MAX_AGE_MS_DEFAULT`, 24 hours. */
  maxAgeMs?: number;
}

/** Whether `secretKey` may verify a Turnstile token against siteverify's fixed testing answer. @internal */
export type RelaxTestingSecret = (secretKey: string) => boolean;
