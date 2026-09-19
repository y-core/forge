import { cloneLogValue } from "./log-clone";
import type { LogKeyVerdict, LogRedactionOptions, LogRedactionPolicy } from "./types";

/** The stems `BOUNDARIES.md` §4a's field classes reduce to, matched as a normalized substring. */
const BUILT_IN_STEMS: readonly string[] = [
  "email",
  "displayname",
  "username",
  "firstname",
  "lastname",
  "givenname",
  "familyname",
  "fullname",
  "nickname",
  "password",
  "passwd",
  "passphrase",
  "passcode",
  "secret",
  "token",
  "apikey",
  "accesskey",
  "privatekey",
  "credential",
  "signature",
  "otp",
  "body",
  "payload",
  "formdata",
  "authorization",
  "bearer",
  "cookie",
  "session",
];

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

/** Lowercases and drops `_` and `-`, so `userEmail`, `user_email` and `USER-EMAIL` match one stem. @internal */
export function normalizeLogKey(key: string): string {
  return key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
}

// Normalized before the empty test, not after: `"-"` and `"_"` are non-empty stems that normalize
// to nothing, and an empty alternative matches every key — silently disabling the pass from `allow`.
/** The stems that can match something, normalized and escaped — a consumer's `a.b` must not match `axb`. */
function usableStems(stems: readonly string[]): string[] {
  return stems.map((stem) => normalizeLogKey(stem)).filter((stem) => stem !== "");
}

function alternation(stems: readonly string[]): RegExp {
  return new RegExp(stems.map((stem) => stem.replace(ESCAPE, "\\$&")).join("|"));
}

/** Compiles a redaction policy; the matchers are built once here, never per record. @public */
export function defineLogRedaction(options?: LogRedactionOptions): LogRedactionPolicy {
  const allow = usableStems(options?.allow ?? []);
  return {
    mode: options?.mode ?? "mask",
    deny: alternation([...BUILT_IN_STEMS, ...usableStems(options?.also ?? [])]),
    allow: allow.length > 0 ? alternation(allow) : null,
  };
}

/** The policy applied when `redact` is omitted: `"mask"`, the built-in stems, nothing allowed back. @public */
export const DEFAULT_LOG_REDACTION: LogRedactionPolicy = defineLogRedaction();

/** `allow` is consulted first, so it wins over both the built-in set and a consumer's own `also`. */
function verdict(key: string, policy: LogRedactionPolicy): LogKeyVerdict {
  const normalized = normalizeLogKey(key);
  if (policy.allow?.test(normalized) === true) return "keep";
  return policy.deny.test(normalized) ? policy.mode : "keep";
}

/** Applies `policy` to a record's `data`, returning a fresh JSON-stable clone. @internal */
export function applyLogRedaction(data: Record<string, unknown>, policy: LogRedactionPolicy): Record<string, unknown> {
  return cloneLogValue(data, (key) => verdict(key, policy)) as Record<string, unknown>;
}
