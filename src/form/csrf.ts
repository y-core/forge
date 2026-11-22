import type { Middleware, RequestContext } from "@remix-run/fetch-router";

import { contextVar } from "../context/accessor";
import type { Refusal } from "../context/types";
import { assertUnwrappedKeyRing, createKeyRingResolver } from "../crypto/keyring/resolver";
import { signWithKeyRing, verifyWithKeyRing } from "../crypto/keyring/sign";
import type { KeyRing } from "../crypto/keyring/types";
import { base64urlDecode, base64urlEncode, bytesToHex, randomBytes, utf8Decode, utf8Encode } from "../crypto/primitives/mod";
import { err, ok } from "../result/result";
import { CSRF_MAX_AGE_MS_DEFAULT } from "./config";
import { CSRF_FIELD_DEFAULT, CSRF_HEADER_DEFAULT } from "./constants";
import { csrfFieldCtx, csrfHeaderCtx } from "./csrf-context";
import { isFormCapConflict, parseFormData } from "./parse-form-data";
import type { CsrfPolicyOptions, CsrfResult, CsrfTokenOptions, CsrfVerifyOptions, ParseFormDataOptions } from "./types";

const CLOCK_SKEW_MS = 30_000;
const CSRF_PURPOSE = "csrf";

const CSRF_MINTER_KEY = "csrf";

/** Typed accessor for the per-request CSRF minter function `csrfMintStage` sets. @public */
export const csrfMinterCtx = contextVar<(path: string) => Promise<string>>(CSRF_MINTER_KEY);

/** Creates a signed CSRF token embedding the ring's active kid, path, optional subject, timestamp, and 16 random bytes. @public */
export async function createCsrfToken(ring: KeyRing, path: string, options: CsrfTokenOptions = {}): Promise<string> {
  const kid = ring.activeKeyId;
  const subject = options.subject ?? "";
  if (subject.includes("|")) throw new Error("CSRF subject must not contain '|'");
  if (path.includes("|")) throw new Error("CSRF path must not contain '|'");
  const timestamp = Date.now().toString();
  const nonce = bytesToHex(randomBytes(16));
  const payload = `${kid}|${path}|${subject}|${timestamp}|${nonce}`;
  const payloadEncoded = base64urlEncode(utf8Encode(payload));
  const { mac } = await signWithKeyRing("createCsrfToken", ring, CSRF_PURPOSE, payload);
  const sigEncoded = base64urlEncode(mac);
  return `${payloadEncoded}.${sigEncoded}`;
}

/** Verifies a CSRF token. @public */
export async function verifyCsrfToken(ring: KeyRing, token: string, path: string, options: CsrfVerifyOptions = {}): Promise<CsrfResult> {
  const maxAgeMs = options.maxAgeMs ?? CSRF_MAX_AGE_MS_DEFAULT;

  if (!token) return err("missing-token");

  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0 || dotIdx === token.length - 1) return err("invalid-format");

  const payloadEncoded = token.slice(0, dotIdx);
  const sigEncoded = token.slice(dotIdx + 1);

  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = base64urlDecode(sigEncoded);
  } catch {
    return err("invalid-format");
  }

  let payloadStr: string;
  try {
    payloadStr = utf8Decode(base64urlDecode(payloadEncoded));
  } catch {
    return err("invalid-format");
  }

  const parts = payloadStr.split("|");
  if (parts.length !== 5) return err("invalid-format");

  const [kid, tokenPath, tokenSubject, timestampStr] = parts as [string, string, string, string, string];
  const timestamp = Number(timestampStr);
  if (!Number.isInteger(timestamp)) return err("expired");
  if (timestamp > Date.now() + CLOCK_SKEW_MS) return err("future-timestamp");
  if (Date.now() - timestamp > maxAgeMs) return err("expired");

  if (tokenPath !== path) return err("path-mismatch");

  if (options.subject !== undefined && tokenSubject !== options.subject) {
    return err("subject-mismatch");
  }

  const verdict = await verifyWithKeyRing("verifyCsrfToken", ring, CSRF_PURPOSE, kid, payloadStr, sigBytes);
  if (verdict === "no-key") return err("unknown-key");
  if (verdict === "forged") return err("invalid-signature");

  return ok();
}

/** Mints a CSRF token bound to `path` using the minter the app's CSRF policy set. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for csrf minting
export async function mintCsrf(context: RequestContext<any, any>, path?: string): Promise<string> {
  if (!path) {
    throw new Error("mintCsrf: a non-empty action path is required to mint a CSRF token");
  }
  const mint = csrfMinterCtx.get(
    context,
    "mintCsrf: no CSRF minter on context — cover this route with the chain's `csrf` policy (its `paths`, outside its `exclude`), or mount csrfMintStage on it",
  );
  return mint(path);
}

/** Throws unless `maxAgeMs` is a whole number of at least one millisecond, naming `operation` as the function the consumer called. @internal */
export function assertCsrfMaxAge(operation: string, maxAgeMs: number | undefined): void {
  if (maxAgeMs === undefined) return;
  if (!Number.isInteger(maxAgeMs)) throw new Error(`${operation}: maxAgeMs is ${maxAgeMs}, which is not a whole number.`);
  if (maxAgeMs < 1) {
    throw new Error(`${operation}: maxAgeMs is ${maxAgeMs}, below the 1-millisecond floor — a token that never verifies refuses every mutation.`);
  }
}

/** Throws when a CSRF policy's `ring` is `createKeyRingResolver`'s wrapper, naming `operation` as the function the consumer called. @internal */
export function assertCsrfRing<Bindings>(operation: string, ring: CsrfPolicyOptions<Bindings>["ring"] | undefined): void {
  if (ring !== undefined) assertUnwrappedKeyRing(operation, ring);
}

/** One request's CSRF work under one policy: publishing the minter, and verifying a mutation's token. */
interface CsrfRequest {
  publish(): void;
  verify(): Promise<CsrfPolicyRefusal | null>;
}

type CsrfPolicyRefusal = Extract<Refusal, { guard: "csrf" }>;

const csrfArmedCtx = contextVar<(() => Promise<CsrfPolicyRefusal | null>) | null>("csrfArmed");

// Narrower than RFC 9110's safe set (`isSafeHttpMethod`): an app can route OPTIONS or TRACE to a handler of its own, so only GET,
// HEAD and a CORS preflight, which a browser sends without a token, skip the verify; any other OPTIONS is held to one.
const CSRF_EXEMPT_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);
const isCorsPreflight = (method: string, headers: Headers): boolean =>
  method === "OPTIONS" && headers.has("Origin") && headers.has("Access-Control-Request-Method");
const isCsrfExempt = (method: string, headers: Headers): boolean => {
  const upper = method.toUpperCase();
  return CSRF_EXEMPT_METHODS.has(upper) || isCorsPreflight(upper, headers);
};

function csrfRequests<Bindings>(
  options: CsrfPolicyOptions<Bindings>,
  isUnbound: (target: URL) => boolean,
  // oxlint-disable-next-line typescript/no-explicit-any -- context shape varies
): (context: RequestContext<any, any>) => CsrfRequest {
  const { tokenField = CSRF_FIELD_DEFAULT, headerName = CSRF_HEADER_DEFAULT } = options;
  const parseOptions: ParseFormDataOptions = options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {};

  assertUnwrappedKeyRing("csrfMintStage", options.ring);
  const resolveRing = createKeyRingResolver(options.ring);

  if (options.subject === "session") {
    throw new Error(
      'csrfMintStage: subject "session" is resolved by applyMiddlewareChain\'s `csrf` policy; mounted by hand, pass a resolver reading the session.',
    );
  }
  const resolveSubject = options.subject === false ? null : options.subject;

  let unboundWarned = false;
  const warnUnbound = () => {
    if (unboundWarned) return;
    unboundWarned = true;
    console.warn(
      "[csrf] the `subject` resolver returned undefined, so no token can be bound to a session. Register the session middleware, and register it BEFORE the CSRF mint stage (the chain's `csrf` policy does) — a resolver reading the session sees nothing when it runs first. Pass `subject: false` to opt out deliberately.",
    );
  };

  return (context) => {
    let resolved: { subject: string | undefined } | undefined;
    const subjectOf = (): string | undefined => {
      if (resolved === undefined) {
        resolved = { subject: resolveSubject ? resolveSubject(context) : undefined };
        if (resolveSubject && resolved.subject === undefined) warnUnbound();
      }
      return resolved.subject;
    };

    return {
      publish() {
        csrfMinterCtx.set(context, async (path: string) => {
          const ring = await resolveRing(context);
          const subject = isUnbound(new URL(path, context.url)) ? undefined : subjectOf();
          return createCsrfToken(ring, path, subject !== undefined ? { subject } : {});
        });
        csrfFieldCtx.set(context, tokenField);
        csrfHeaderCtx.set(context, headerName);
      },
      async verify() {
        const unbound = isUnbound(context.url);
        const subject = unbound ? undefined : subjectOf();
        if (!unbound && resolveSubject && subject === undefined) {
          return { guard: "csrf", status: 403, reason: "unbound-subject" };
        }

        const headerToken = context.request.headers.get(headerName);
        let token: string | undefined = headerToken ?? undefined;

        if (!token && context.request.body !== null) {
          try {
            const formData = await parseFormData(context, parseOptions);
            token = formData.get(tokenField)?.toString() ?? undefined;
          } catch (error) {
            if (isFormCapConflict(error)) throw error;
            if ((error as { status?: number }).status === 413) return { guard: "csrf", status: 413, reason: "too-large" };
            return { guard: "csrf", status: 400, reason: "unreadable-body" };
          }
        }

        const ring = await resolveRing(context);
        const result = await verifyCsrfToken(ring, token ?? "", context.url.pathname, {
          ...(subject !== undefined ? { subject } : {}),
          ...(options.maxAgeMs !== undefined ? { maxAgeMs: options.maxAgeMs } : {}),
        });
        return result.ok ? null : { guard: "csrf", status: 403, reason: result.error };
      },
    };
  };
}

/** Publishes the minter, field and header, and on a mutation arms this policy's verification for `csrfVerifyStage` to run; a token whose target `isUnbound` answers true is path-only. @public */
export function csrfMintStage<Bindings = Record<string, unknown>>(
  options: CsrfPolicyOptions<Bindings>,
  isUnbound: (target: URL) => boolean = () => false,
): Middleware {
  assertCsrfMaxAge("csrfMintStage", options.maxAgeMs);
  const requestFor = csrfRequests(options, isUnbound);
  return (context, next) => {
    const request = requestFor(context);
    request.publish();
    if (!isCsrfExempt(context.method, context.request.headers)) csrfArmedCtx.set(context, () => request.verify());
    return next();
  };
}

/** Runs the verification a `csrfMintStage` armed on this request, at most once, answering a refusal with `answer`; a no-op when nothing is armed. @internal */
export function csrfVerifyStage(
  // oxlint-disable-next-line typescript/no-explicit-any -- context shape varies
  answer: (context: RequestContext<any, any>, refusal: Refusal) => Response | Promise<Response>,
): Middleware {
  return async (context, next) => {
    const armed = csrfArmedCtx.getOptional(context);
    if (!armed) return next();
    csrfArmedCtx.set(context, null);
    const refusal = await armed();
    return refusal === null ? next() : answer(context, refusal);
  };
}
