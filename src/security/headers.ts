import type { Middleware, RequestContext } from "@remix-run/fetch-router";
import { contextVar } from "../context/accessor";
import { setPendingHeader } from "../context/pending-headers";
import { base64urlEncode, randomBytes } from "../crypto/mod";
import { NONCE } from "./nonce";
import type { PermissionsPolicyOptions, SecurityHeadersOptions } from "./types";

const CSP_DIRECTIVES = ["scriptSrc", "connectSrc", "frameSrc", "imgSrc", "workerSrc", "childSrc"] as const;

const PERMISSIONS_POLICY_FEATURES = ["camera", "microphone", "geolocation", "payment"] as const;

function renderAllowlist(sources?: string[]): string {
  if (!sources || sources.length === 0) return "()";
  return `(${sources.map((s) => (s === "self" || s === "*" || s === "src" ? s : `"${s}"`)).join(" ")})`;
}

function buildPermissionsPolicy(o?: PermissionsPolicyOptions): string {
  return PERMISSIONS_POLICY_FEATURES.map((f) => `${f}=${renderAllowlist(o ? o[f] : undefined)}`).join(", ");
}

const secureHeadersNonce = contextVar<string>("secureHeadersNonce");

/** Returns the CSP nonce set for the current request, or `""` when none is set. @public */
// biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for nonce access
export function getNonce(c: RequestContext<any, any>): string {
  return secureHeadersNonce.getOptional(c) ?? "";
}

/** Rejects empty or whitespace-only CSP source entries, which silently break the policy. */
function assertValidDirective(name: string, sources: readonly (string | symbol)[]): void {
  for (const source of sources) {
    if (typeof source === "string" && source.trim() === "") {
      throw new Error(`Invalid CSP directive "${name}": source entries must be non-empty strings`);
    }
  }
}

/** Layers extra CSP sources onto a base policy, concatenating each directive's source list. @public */
export function mergeSecurityHeaders(base: SecurityHeadersOptions, extra: Partial<SecurityHeadersOptions>): SecurityHeadersOptions {
  const merged: SecurityHeadersOptions = { ...base };
  for (const key of CSP_DIRECTIVES) {
    const extraSources = extra[key];
    if (extraSources) merged[key] = [...(base[key] ?? []), ...extraSources];
  }
  if (extra.hstsMaxAge !== undefined) merged.hstsMaxAge = extra.hstsMaxAge;
  if (extra.permissionsPolicy) merged.permissionsPolicy = { ...base.permissionsPolicy, ...extra.permissionsPolicy };
  return merged;
}

function generateNonce(): string {
  return base64urlEncode(randomBytes(16));
}

function renderCspValues(values: readonly (string | symbol)[], nonce: string): string {
  return values.map((v) => (v === NONCE ? `'nonce-${nonce}'` : (v as string))).join(" ");
}

function buildCsp(nonce: string, options?: SecurityHeadersOptions): string {
  const scriptSrc = options?.scriptSrc ?? ["'self'", NONCE];
  const connectSrc = options?.connectSrc ?? ["'self'"];
  const frameSrc = options?.frameSrc ?? ["'self'"];
  const imgSrc = options?.imgSrc ?? ["'self'", "data:"];

  const parts: string[] = [
    `default-src 'self'`,
    `script-src ${renderCspValues(scriptSrc, nonce)}`,
    // Deliberately strict: no `'unsafe-inline'`. Forge components emit zero inline `style=`
    // attributes (the JSX renderer drops the `style` prop under this policy — see
    // render-to-string.ts), so inline styles would be blocked by the browser and must not ship.
    `style-src 'self'`,
    `img-src ${renderCspValues(imgSrc, nonce)}`,
    `font-src 'self'`,
    `connect-src ${renderCspValues(connectSrc, nonce)}`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src ${renderCspValues(frameSrc, nonce)}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `upgrade-insecure-requests`,
  ];
  if (options?.workerSrc) parts.push(`worker-src ${renderCspValues(options.workerSrc, nonce)}`);
  if (options?.childSrc) parts.push(`child-src ${renderCspValues(options.childSrc, nonce)}`);
  return parts.join("; ");
}

/** Computes the full set of forge security headers for `nonce` and `options`. */
function securityHeaderEntries(nonce: string, options?: SecurityHeadersOptions): [string, string][] {
  const hstsMaxAge = options?.hstsMaxAge ?? 63072000;
  return [
    ["content-security-policy", buildCsp(nonce, options)],
    ["strict-transport-security", `max-age=${hstsMaxAge}; includeSubDomains; preload`],
    ["referrer-policy", "strict-origin-when-cross-origin"],
    ["x-content-type-options", "nosniff"],
    ["permissions-policy", buildPermissionsPolicy(options?.permissionsPolicy)],
    ["x-frame-options", "DENY"],
  ];
}

/**
 * Applies forge's security headers directly to `response`, returning a new Response.
 * Used for out-of-band responses that never pass through the middleware chain (e.g. an
 * error page produced before the chain runs). A fresh nonce is minted when none is supplied. @public
 */
export function applySecurityHeaders(response: Response, options?: SecurityHeadersOptions, nonce: string = generateNonce()): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of securityHeaderEntries(nonce, options)) {
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Middleware factory that applies CSP with a per-request nonce, HSTS, referrer-policy,
 * x-content-type-options, and permissions-policy to every response. @public
 */
export function makeSecurityHeaders(options?: SecurityHeadersOptions): Middleware {
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

  return async (context, next) => {
    const nonce = generateNonce();
    secureHeadersNonce.set(context, nonce);

    const response = await next();

    // Queue headers on the pending channel so the single `applyHeaders` pass rebuilds the
    // response body once, instead of each middleware constructing its own Response.
    for (const [name, value] of securityHeaderEntries(nonce, options)) {
      setPendingHeader(context, name, value);
    }

    return response;
  };
}
