import type { Context, Env, MiddlewareHandler } from "hono";
import { NONCE, secureHeaders } from "hono/secure-headers";
import { contextVar } from "../context/accessor";
import type { SecurityHeadersOptions } from "./types";

/** Bare variable record set by Hono's `secureHeaders` middleware. @public */
export type SecureHeadersContext = { secureHeadersNonce?: string };

const CSP_DIRECTIVES = [
  "scriptSrc",
  "connectSrc",
  "frameSrc",
  "imgSrc",
  "workerSrc",
  "childSrc",
] as const;

const secureHeadersNonce = contextVar<string>("secureHeadersNonce");

/** Returns the CSP nonce Hono's `secureHeaders` sets for the current request, or "" when none is set. @public */
export function getNonce<E extends Env>(c: Context<E>): string {
  return secureHeadersNonce.getOptional(c) ?? "";
}

/** Rejects empty or whitespace-only CSP source entries, which silently break the policy. */
function assertValidDirective(name: string, sources: readonly unknown[]): void {
  for (const source of sources) {
    if (typeof source === "string" && source.trim() === "") {
      throw new Error(`Invalid CSP directive "${name}": source entries must be non-empty strings`);
    }
  }
}

/** Layers extra CSP sources onto a base policy, concatenating each directive's source list.
 *  Lets callers inject environment-specific sources (e.g. a dev-only script hash) onto a
 *  shared base policy without mutating it. @public */
export function mergeSecurityHeaders(base: SecurityHeadersOptions, extra: Partial<SecurityHeadersOptions>): SecurityHeadersOptions {
  const merged: SecurityHeadersOptions = { ...base };
  for (const key of CSP_DIRECTIVES) {
    const extraSources = extra[key];
    if (extraSources) merged[key] = [...(base[key] ?? []), ...extraSources];
  }
  if (extra.hstsMaxAge !== undefined) merged.hstsMaxAge = extra.hstsMaxAge;
  return merged;
}

/** Middleware factory that applies CSP, HSTS, referrer-policy, and permissions-policy headers. @public */
export function makeSecurityHeaders(options?: SecurityHeadersOptions): MiddlewareHandler {
  const { hstsMaxAge = 63072000 } = options ?? {};

  const scriptSrc = options?.scriptSrc ?? ["'self'", NONCE];
  const connectSrc = options?.connectSrc ?? ["'self'"];
  const frameSrc = options?.frameSrc ?? ["'self'"];
  const imgSrc = options?.imgSrc ?? ["'self'", "data:"];

  assertValidDirective("scriptSrc", scriptSrc);
  assertValidDirective("connectSrc", connectSrc);
  assertValidDirective("frameSrc", frameSrc);
  assertValidDirective("imgSrc", imgSrc);
  if (options?.workerSrc) assertValidDirective("workerSrc", options.workerSrc);
  if (options?.childSrc) assertValidDirective("childSrc", options.childSrc);

  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc,
      styleSrc: ["'self'"],
      imgSrc,
      fontSrc: ["'self'"],
      connectSrc,
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      frameSrc,
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: [],
      ...(options?.workerSrc ? { workerSrc: options.workerSrc } : {}),
      ...(options?.childSrc ? { childSrc: options.childSrc } : {}),
    },
    strictTransportSecurity: `max-age=${hstsMaxAge}; includeSubDomains; preload`,
    referrerPolicy: "strict-origin-when-cross-origin",
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
    },
  });
}
