import type { Middleware, RequestContext } from "@remix-run/fetch-router";
import { contextVar } from "../context/accessor";
import { setPendingHeader } from "../context/pending-headers";
import { base64urlEncode, randomBytes } from "../crypto/mod";
import { NONCE } from "./nonce";
import type { ApplySecurityHeadersOptions, CspSourceValue, PermissionsPolicyOptions, SecurityHeadersOptions } from "./types";

const CSP_DIRECTIVES = ["scriptSrc", "connectSrc", "frameSrc", "imgSrc", "styleSrc", "fontSrc", "workerSrc", "childSrc"] as const;

type CspDirective = (typeof CSP_DIRECTIVES)[number];

// `workerSrc` and `childSrc` have no default: they are emitted only when the caller provides them.
const CSP_DEFAULTS: Readonly<Partial<Record<CspDirective, readonly CspSourceValue[]>>> = {
  scriptSrc: ["'self'", NONCE],
  connectSrc: ["'self'"],
  frameSrc: ["'self'"],
  imgSrc: ["'self'", "data:"],
  styleSrc: ["'self'"],
  fontSrc: ["'self'"],
};

const CSP_SOURCE_TOKEN = /^[\x21-\x7e]+$/;

const PERMISSIONS_POLICY_FEATURES = ["camera", "microphone", "geolocation", "payment"] as const;

function renderAllowlist(sources?: string[]): string {
  if (!sources || sources.length === 0) return "()";
  return `(${sources.map((s) => (s === "self" || s === "*" || s === "src" ? s : `"${s}"`)).join(" ")})`;
}

function buildPermissionsPolicy(o?: PermissionsPolicyOptions): string {
  return PERMISSIONS_POLICY_FEATURES.map((f) => `${f}=${renderAllowlist(o ? o[f] : undefined)}`).join(", ");
}

const secureHeadersNonce = contextVar<string>("secureHeadersNonce");

/** Returns the CSP nonce `createSecurityHeaders` set for the current request, or `""` when it has not run. @public */
// biome-ignore lint/suspicious/noExplicitAny: bindings are irrelevant for nonce access
export function getNonce(c: RequestContext<any, any>): string {
  return secureHeadersNonce.getOptional(c) ?? "";
}

/** Rejects CSP source entries that would break the policy or smuggle in a further directive. */
function assertValidDirective(name: string, sources: readonly CspSourceValue[]): void {
  for (const source of sources) {
    if (typeof source !== "string") continue;
    if (source.trim() === "") {
      throw new Error(`Invalid CSP directive "${name}": source entries must be non-empty strings`);
    }
    if (!CSP_SOURCE_TOKEN.test(source) || source.includes(";") || source.includes(",")) {
      throw new Error(
        `Invalid CSP directive "${name}": source entries must be single CSP source tokens (no whitespace, ';', ',' or control characters)`,
      );
    }
    if (source.toLowerCase() === "'unsafe-inline'") {
      throw new Error(`Invalid CSP directive "${name}": 'unsafe-inline' is never permitted`);
    }
  }
}

function resolveCspSources(name: CspDirective, options?: SecurityHeadersOptions): readonly CspSourceValue[] {
  return options?.[name] ?? CSP_DEFAULTS[name] ?? [];
}

function assertValidCspOptions(options?: SecurityHeadersOptions): void {
  for (const name of CSP_DIRECTIVES) {
    assertValidDirective(name, resolveCspSources(name, options));
  }
}

/** Layers extra CSP sources onto a base policy, concatenating each directive's source list. @public */
export function mergeSecurityHeaders(base: SecurityHeadersOptions, extra: Partial<SecurityHeadersOptions>): SecurityHeadersOptions {
  const merged: SecurityHeadersOptions = { ...base };
  for (const key of CSP_DIRECTIVES) {
    const extraSources = extra[key];
    if (extraSources) merged[key] = [...(base[key] ?? CSP_DEFAULTS[key] ?? []), ...extraSources];
  }
  if (extra.hstsMaxAge !== undefined) merged.hstsMaxAge = extra.hstsMaxAge;
  if (extra.permissionsPolicy) merged.permissionsPolicy = { ...base.permissionsPolicy, ...extra.permissionsPolicy };
  if (extra.crossOriginOpenerPolicy !== undefined) merged.crossOriginOpenerPolicy = extra.crossOriginOpenerPolicy;
  if (extra.crossOriginResourcePolicy !== undefined) merged.crossOriginResourcePolicy = extra.crossOriginResourcePolicy;
  if (extra.crossOriginEmbedderPolicy !== undefined) merged.crossOriginEmbedderPolicy = extra.crossOriginEmbedderPolicy;
  return merged;
}

function generateNonce(): string {
  return base64urlEncode(randomBytes(16));
}

function renderCspValues(values: readonly (string | symbol)[], nonce: string): string {
  return values.map((v) => (v === NONCE ? `'nonce-${nonce}'` : (v as string))).join(" ");
}

function buildCsp(nonce: string, options?: SecurityHeadersOptions): string {
  const scriptSrc = resolveCspSources("scriptSrc", options);
  const connectSrc = resolveCspSources("connectSrc", options);
  const frameSrc = resolveCspSources("frameSrc", options);
  const imgSrc = resolveCspSources("imgSrc", options);
  const styleSrc = resolveCspSources("styleSrc", options);
  const fontSrc = resolveCspSources("fontSrc", options);

  const parts: string[] = [
    `default-src 'self'`,
    `script-src ${renderCspValues(scriptSrc, nonce)}`,
    // No `'unsafe-inline'`: the JSX renderer drops the `style` prop to match this policy.
    `style-src ${renderCspValues(styleSrc, nonce)}`,
    `img-src ${renderCspValues(imgSrc, nonce)}`,
    `font-src ${renderCspValues(fontSrc, nonce)}`,
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

function securityHeaderEntries(nonce: string, options?: SecurityHeadersOptions): [string, string][] {
  const hstsMaxAge = options?.hstsMaxAge ?? 63072000;
  const entries: [string, string][] = [
    ["content-security-policy", buildCsp(nonce, options)],
    ["strict-transport-security", `max-age=${hstsMaxAge}; includeSubDomains; preload`],
    ["referrer-policy", "strict-origin-when-cross-origin"],
    ["x-content-type-options", "nosniff"],
    ["permissions-policy", buildPermissionsPolicy(options?.permissionsPolicy)],
    ["x-frame-options", "DENY"],
    ["cross-origin-opener-policy", options?.crossOriginOpenerPolicy ?? "same-origin"],
    ["cross-origin-resource-policy", options?.crossOriginResourcePolicy ?? "same-origin"],
  ];
  // COEP is opt-in: `require-corp` breaks every subresource lacking CORP/CORS opt-in.
  if (options?.crossOriginEmbedderPolicy) {
    entries.push(["cross-origin-embedder-policy", options.crossOriginEmbedderPolicy]);
  }
  return entries;
}

/** Applies forge's security headers to `response`, minting a nonce when `options.nonce` is omitted. @public */
export function applySecurityHeaders(response: Response, options?: ApplySecurityHeadersOptions): Response {
  const { nonce = generateNonce(), ...headerOptions } = options ?? {};
  assertValidCspOptions(headerOptions);
  const headers = new Headers(response.headers);
  for (const [name, value] of securityHeaderEntries(nonce, headerOptions)) {
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Middleware applying CSP with a per-request nonce, HSTS, and the rest of forge's security headers. @public */
export function createSecurityHeaders(options?: SecurityHeadersOptions): Middleware {
  assertValidCspOptions(options);

  return async (context, next) => {
    const nonce = generateNonce();
    secureHeadersNonce.set(context, nonce);

    // Queued before `next()` so the headers still reach the error page when anything deeper throws.
    for (const [name, value] of securityHeaderEntries(nonce, options)) {
      setPendingHeader(context, name, value);
    }

    return next();
  };
}
