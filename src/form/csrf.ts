import type { Middleware, RequestContext } from "@remix-run/fetch-router";

import { contextVar } from "../context/accessor";
import { signWithKeyRing, verifyWithKeyRing } from "../crypto/keyring/sign";
import type { KeyRing } from "../crypto/keyring/types";
import { base64urlDecode, base64urlEncode, bytesToHex, randomBytes, utf8Decode, utf8Encode } from "../crypto/primitives/mod";
import { err, ok } from "../result/result";
import { CSRF_FIELD_DEFAULT, CSRF_HEADER_DEFAULT } from "./constants";
import { csrfFieldCtx, csrfHeaderCtx } from "./csrf-context";
import { isFormCapConflict, parseFormData } from "./parse-form-data";
import type {
  CsrfMinterOptions,
  CsrfProtectionOptions,
  CsrfResult,
  CsrfRingResolver,
  CsrfTokenOptions,
  CsrfVerifyOptions,
  ParseFormDataOptions,
} from "./types";

const CLOCK_SKEW_MS = 30_000;
const CSRF_PURPOSE = "csrf";

const CSRF_MINTER_KEY = "csrf";
const CSRF_TOKEN_KEY = "csrfToken";

/** Typed accessor for the per-request CSRF minter function set by `csrfProtection`. @public */
export const csrfMinterCtx = contextVar<(path: string) => Promise<string>>(CSRF_MINTER_KEY);
/** Typed accessor for the pre-minted CSRF token, bound to the current request's pathname, set by `csrfProtection` on GET/HEAD. @public */
export const csrfTokenCtx = contextVar<string>(CSRF_TOKEN_KEY);

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
  const maxAgeMs = options.maxAgeMs ?? 3_600_000;

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

/** Mints a CSRF token bound to `path` using the minter set by `csrfProtection`. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for csrf minting
export async function mintCsrf(context: RequestContext<any, any>, path?: string): Promise<string> {
  if (!path) {
    throw new Error("mintCsrf: a non-empty action path is required to mint a CSRF token");
  }
  const mint = csrfMinterCtx.get(context, "mintCsrf: no CSRF minter on context — mount csrfProtection on this route");
  return mint(path);
}

/** CSRF key-ring resolver type. @public */
export type { CsrfRingResolver };

/** Resolves the ring `resolve` names, cached per `env` — a key import on every request is pure waste. */
// oxlint-disable-next-line typescript/no-explicit-any -- context shape varies
function ringResolver(resolve: CsrfRingResolver): (context: RequestContext<any, any>) => Promise<KeyRing> {
  const ringCache = new WeakMap<object, KeyRing>();
  // oxlint-disable-next-line typescript/no-explicit-any -- context shape varies
  return async (context: RequestContext<any, any>): Promise<KeyRing> => {
    // oxlint-disable-next-line typescript/no-explicit-any -- env shape varies across apps and tests
    const envObj = (context as any).env;
    const cacheKey = envObj && typeof envObj === "object" ? (envObj as object) : null;
    if (cacheKey) {
      const hit = ringCache.get(cacheKey);
      if (hit) return hit;
    }
    const ring = await resolve(context);
    if (cacheKey) ringCache.set(cacheKey, ring);
    return ring;
  };
}

/** Mints a token for a path this request is not on, under the subject policy that path's guard verifies with. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- context shape varies
export function csrfMinter(options: CsrfMinterOptions): (context: RequestContext<any, any>, path: string) => Promise<string> {
  const resolveRing = ringResolver(options.ring);
  const resolveSubject = options.subject === false ? null : options.subject;
  // oxlint-disable-next-line typescript/no-explicit-any -- context shape varies
  return async (context: RequestContext<any, any>, path: string): Promise<string> => {
    if (!path) throw new Error("csrfMinter: a non-empty action path is required to mint a CSRF token");
    const ring = await resolveRing(context);
    const subject = resolveSubject ? resolveSubject(context) : undefined;
    // A bound token nothing supplied a subject for would be minted only to be refused, so the
    // wiring error is raised where it can be fixed rather than carried into the form.
    if (resolveSubject && subject === undefined) {
      throw new Error(
        "csrfMinter: the `subject` resolver returned undefined, so no token can be bound to a session. Register the session middleware, and register it BEFORE the mint — a resolver reading the session sees nothing when it runs first. Pass `subject: false` to opt out deliberately.",
      );
    }
    return createCsrfToken(ring, path, subject !== undefined ? { subject } : {});
  };
}

/** Middleware that sets a CSRF token on GET requests and verifies it on mutations. @public */
export function csrfProtection(options: CsrfProtectionOptions): Middleware {
  const { tokenField = CSRF_FIELD_DEFAULT, headerName = CSRF_HEADER_DEFAULT } = options;
  const parseOptions: ParseFormDataOptions = options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {};

  const resolveRing = ringResolver(options.ring);

  // `null` where `subject: false` opted out, so "no resolver" and "the resolver returned nothing" stay distinguishable.
  const resolveSubject = options.subject === false ? null : options.subject;

  // Per-instance, so one wiring error logs once per app rather than once per hostile request.
  let unboundWarned = false;
  const warnUnbound = () => {
    if (unboundWarned) return;
    unboundWarned = true;
    console.warn(
      "[csrf] the `subject` resolver returned undefined, so no token can be bound to a session. Register the session middleware, and register it BEFORE csrfProtection — a resolver reading the session sees nothing when it runs first. Pass `subject: false` to opt out deliberately.",
    );
  };

  return async (context, next) => {
    const method = context.method.toUpperCase();
    const ring = await resolveRing(context);
    const subject = resolveSubject ? resolveSubject(context) : undefined;
    if (resolveSubject && subject === undefined) warnUnbound();
    const tokenOptions: CsrfTokenOptions = subject !== undefined ? { subject } : {};

    csrfMinterCtx.set(context, (path: string) => createCsrfToken(ring, path, tokenOptions));
    // Published above every early return: a mutation must know which field was consumed, and a page render must know which header to send the token on.
    csrfFieldCtx.set(context, tokenField);
    csrfHeaderCtx.set(context, headerName);

    if (method === "GET" || method === "HEAD") {
      csrfTokenCtx.set(context, await createCsrfToken(ring, context.url.pathname, tokenOptions));
      return next();
    }

    // A resolver that returned nothing is a wiring error, not a policy: refuse rather than verify an unbound token.
    if (resolveSubject && subject === undefined) {
      return new Response("Forbidden", { status: 403 });
    }

    const headerToken = context.request.headers.get(headerName);
    let token: string | undefined = headerToken ?? undefined;

    if (!token) {
      try {
        const formData = await parseFormData(context, parseOptions);
        token = formData.get(tokenField)?.toString() ?? undefined;
      } catch (error) {
        // A cap conflict is the app's wiring, not the client's request: swallowing it would answer 403
        // and leave the route permanently broken with nothing naming why.
        if (isFormCapConflict(error)) throw error;
        // A size failure is not a CSRF failure; reporting 403 would send the client after the wrong problem.
        if ((error as { status?: number }).status === 413) {
          return new Response("Payload Too Large", { status: 413 });
        }
      }
    }

    const result = await verifyCsrfToken(ring, token ?? "", context.url.pathname, { ...(subject !== undefined ? { subject } : {}) });
    if (!result.ok) {
      return new Response("Forbidden", { status: 403 });
    }

    return next();
  };
}
