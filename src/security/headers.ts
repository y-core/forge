import type { Middleware, RequestContext } from "@remix-run/fetch-router";

import { contextVar } from "../context/accessor";
import { setPendingHeader } from "../context/pending-headers";
import { base64urlEncode, randomBytes } from "../crypto/mod";
import { NONCE } from "./nonce";
import type {
  ApplySecurityHeadersOptions,
  CspDirectiveOptions,
  CspOptions,
  CspReportingOptions,
  CspSourceValue,
  HstsOptions,
  PermissionsPolicyOptions,
  SecurityHeadersOptions,
  TrustedTypesOptions,
} from "./types";
import { UNSAFE_CSP_SOURCES, UNSAFE_INLINE } from "./unsafe";

const CSP_DIRECTIVES = ["scriptSrc", "connectSrc", "frameSrc", "imgSrc", "styleSrc", "fontSrc", "workerSrc", "childSrc"] as const;

type CspDirective = (typeof CSP_DIRECTIVES)[number];

const CSP_DIRECTIVE_FIELDS = [...CSP_DIRECTIVES, "trustedTypes"] as const;

const CSP_DEFAULTS: Readonly<Partial<Record<CspDirective, readonly CspSourceValue[]>>> = {
  scriptSrc: ["'self'", NONCE],
  connectSrc: ["'self'"],
  frameSrc: ["'self'"],
  imgSrc: ["'self'", "data:"],
  styleSrc: ["'self'"],
  fontSrc: ["'self'"],
};

const CSP_SOURCE_TOKEN = /^[\x21-\x7e]+$/;

const CSP_HASH_SOURCE = /^'(sha256|sha384|sha512)-/i;

// Tighter than `CSP_SOURCE_TOKEN`, which admits `'` and would let a caller close the quoted
// nonce source and append a further one — `'unsafe-inline'` among them.
const CSP_NONCE_VALUE = /^[A-Za-z0-9+/_-]+={0,2}$/;

const FORBIDDEN_CSP_SOURCES: ReadonlyMap<string, string> = new Map(UNSAFE_CSP_SOURCES.map((s) => [s.token, s.exportName]));

const TRUSTED_TYPES_POLICY_NAME = /^[A-Za-z0-9\-#=_/@.%]+$/;

const CSP_REPORTING_GROUP = /^[a-z][a-z0-9_-]*$/;

const CSP_REPORTING_GROUP_DEFAULT = "csp-endpoint";

const CSP_REPORTING_ENDPOINT_FORBIDDEN = [";", ",", '"', "\\"] as const;

const ROOT_RELATIVE_PARSE_BASE = "https://h.invalid";

const PERMISSIONS_POLICY_FEATURES = ["camera", "microphone", "geolocation", "payment"] as const;

function renderAllowlist(sources?: string[]): string {
  if (!sources || sources.length === 0) return "()";
  return `(${sources.map((s) => (s === "self" || s === "*" || s === "src" ? s : `"${s}"`)).join(" ")})`;
}

function buildPermissionsPolicy(o?: PermissionsPolicyOptions): string {
  return PERMISSIONS_POLICY_FEATURES.map((f) => `${f}=${renderAllowlist(o ? o[f] : undefined)}`).join(", ");
}

const secureHeadersNonce = contextVar<string>("secureHeadersNonce");

const securityHeadersBase = contextVar<SecurityHeadersOptions>("secureHeadersOptions");

/** Returns the CSP nonce `createSecurityHeaders` set for the current request, or `""` when it has not run. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant for nonce access
export function getNonce(c: RequestContext<any, any>): string {
  return secureHeadersNonce.getOptional(c) ?? "";
}

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
    const lowered = source.toLowerCase();
    const exportName = FORBIDDEN_CSP_SOURCES.get(lowered);
    if (exportName) {
      throw new Error(
        `Invalid CSP directive "${name}": ${lowered} is never permitted as a string — import ${exportName} from "@y-core/forge/security" to opt in deliberately`,
      );
    }
  }
  if (sources.includes(UNSAFE_INLINE)) {
    const ignoredBy = sources.some((s) => s === NONCE || (typeof s === "string" && CSP_HASH_SOURCE.test(s)));
    if (ignoredBy) {
      throw new Error(
        `Invalid CSP directive "${name}": UNSAFE_INLINE has no effect beside a nonce or hash source, which CSP Level 3 has the browser ignore it next to — remove the nonce or hash from this directive, or remove UNSAFE_INLINE`,
      );
    }
  }
}

function resolveCspSources(name: CspDirective, options: CspDirectiveOptions): readonly CspSourceValue[] {
  return options[name] ?? CSP_DEFAULTS[name] ?? [];
}

function assertValidTrustedTypes(prefix: string, trustedTypes?: TrustedTypesOptions): void {
  if (!trustedTypes) return;
  for (const name of trustedTypes.policies) {
    if (!TRUSTED_TYPES_POLICY_NAME.test(name)) {
      throw new Error(`Invalid Trusted Types policy name ${JSON.stringify(name)}: must be one or more of A-Z a-z 0-9 - # = _ / @ . %`);
    }
  }
  if (trustedTypes.allowDuplicates && trustedTypes.policies.length === 0) {
    throw new Error(`Invalid ${prefix}trustedTypes: allowDuplicates needs at least one policy name`);
  }
}

function isValidCspReportingEndpoint(endpoint: string): boolean {
  if (!CSP_SOURCE_TOKEN.test(endpoint)) return false;
  if (CSP_REPORTING_ENDPOINT_FORBIDDEN.some((c) => endpoint.includes(c))) return false;
  if (endpoint.startsWith("/") && !endpoint.startsWith("//")) return URL.canParse(endpoint, ROOT_RELATIVE_PARSE_BASE);
  return URL.canParse(endpoint) && new URL(endpoint).protocol === "https:";
}

function assertValidCspReporting(reporting?: CspReportingOptions): void {
  if (!reporting) return;
  const { endpoint, group } = reporting;
  if (!isValidCspReportingEndpoint(endpoint)) {
    throw new Error(
      `Invalid CSP reporting endpoint ${JSON.stringify(endpoint)}: must be an absolute https URL or a root-relative path with no whitespace, ';', ',', '"' or '\\'`,
    );
  }
  if (group !== undefined && !CSP_REPORTING_GROUP.test(group)) {
    throw new Error(
      `Invalid CSP reporting group ${JSON.stringify(group)}: must be a lowercase letter followed by lowercase letters, digits, '_' or '-'`,
    );
  }
}

function assertValidCspDirectives(prefix: string, options: CspDirectiveOptions): void {
  for (const name of CSP_DIRECTIVES) {
    assertValidDirective(prefix + name, resolveCspSources(name, options));
  }
  assertValidTrustedTypes(prefix, options.trustedTypes);
}

function pickCspDirectives(options: CspDirectiveOptions): CspDirectiveOptions {
  const stated = CSP_DIRECTIVE_FIELDS.map((key) => [key, options[key]] as const).filter(([, value]) => value !== undefined);
  return Object.fromEntries(stated) as CspDirectiveOptions;
}

function resolveReportOnly(options: CspDirectiveOptions, reportOnly: CspDirectiveOptions): CspDirectiveOptions {
  return { ...pickCspDirectives(options), ...pickCspDirectives(reportOnly) };
}

const HSTS_DEFAULT_MAX_AGE = 63072000;

function assertValidHstsOptions(hsts?: false | HstsOptions): void {
  if (!hsts || hsts.maxAge === undefined) return;
  if (!Number.isInteger(hsts.maxAge) || hsts.maxAge < 0) {
    throw new Error(`Invalid HSTS maxAge ${String(hsts.maxAge)}: must be a non-negative integer number of seconds`);
  }
}

function assertValidSecurityHeadersOptions(options: SecurityHeadersOptions = {}): void {
  assertValidCspDirectives("", options);
  if (options.reportOnly) assertValidCspDirectives("reportOnly.", resolveReportOnly(options, options.reportOnly));
  assertValidCspReporting(options.reporting);
  assertValidHstsOptions(options.hsts);
}

function mergeHstsOptions(base: false | HstsOptions | undefined, extra: false | HstsOptions): false | HstsOptions {
  if (extra === false || !base) return extra;
  const stated = Object.entries(extra).filter(([, value]) => value !== undefined);
  return { ...base, ...Object.fromEntries(stated) };
}

function buildHsts(hsts: HstsOptions): string {
  const tokens = [`max-age=${hsts.maxAge ?? HSTS_DEFAULT_MAX_AGE}`];
  if (hsts.includeSubDomains !== false) tokens.push("includeSubDomains");
  if (hsts.preload !== false) tokens.push("preload");
  return tokens.join("; ");
}

function mergeTrustedTypes(base: TrustedTypesOptions | undefined, extra: TrustedTypesOptions): TrustedTypesOptions {
  if (!base) return extra;
  return {
    policies: [...base.policies, ...extra.policies],
    allowDuplicates: extra.allowDuplicates ?? base.allowDuplicates,
    require: extra.require ?? base.require,
  };
}

function mergeCspDirectives(base: CspDirectiveOptions, extra: CspDirectiveOptions, inherited: CspDirectiveOptions): CspDirectiveOptions {
  const merged: CspDirectiveOptions = {};
  for (const key of CSP_DIRECTIVES) {
    const extraSources = extra[key];
    if (extraSources) merged[key] = [...(base[key] ?? inherited[key] ?? CSP_DEFAULTS[key] ?? []), ...extraSources];
  }
  if (extra.trustedTypes) merged.trustedTypes = mergeTrustedTypes(base.trustedTypes ?? inherited.trustedTypes, extra.trustedTypes);
  return merged;
}

/** Layers extra CSP sources onto a base policy, concatenating each directive's source list. @public */
export function mergeSecurityHeaders(base: SecurityHeadersOptions, extra: Partial<SecurityHeadersOptions>): SecurityHeadersOptions {
  const merged: SecurityHeadersOptions = { ...base, ...mergeCspDirectives(base, extra, {}) };
  if (extra.reportOnly) merged.reportOnly = { ...base.reportOnly, ...mergeCspDirectives(base.reportOnly ?? {}, extra.reportOnly, merged) };
  if (extra.reporting) merged.reporting = extra.reporting;
  if (extra.hsts !== undefined) merged.hsts = mergeHstsOptions(base.hsts, extra.hsts);
  if (extra.permissionsPolicy) merged.permissionsPolicy = { ...base.permissionsPolicy, ...extra.permissionsPolicy };
  if (extra.crossOriginOpenerPolicy !== undefined) merged.crossOriginOpenerPolicy = extra.crossOriginOpenerPolicy;
  if (extra.crossOriginResourcePolicy !== undefined) merged.crossOriginResourcePolicy = extra.crossOriginResourcePolicy;
  if (extra.crossOriginEmbedderPolicy !== undefined) merged.crossOriginEmbedderPolicy = extra.crossOriginEmbedderPolicy;
  if (extra.referrerPolicy !== undefined) merged.referrerPolicy = extra.referrerPolicy;
  return merged;
}

function generateNonce(): string {
  return base64urlEncode(randomBytes(16));
}

function renderCspValue(value: CspSourceValue, nonce: string): string {
  if (typeof value === "string") return value;
  if (value === NONCE) return `'nonce-${nonce}'`;
  const entry = UNSAFE_CSP_SOURCES.find((s) => s.placeholder === value);
  if (!entry) throw new Error("Invalid CSP source: unknown placeholder symbol");
  return entry.token;
}

function renderCspValues(values: readonly CspSourceValue[], nonce: string): string {
  return values.map((v) => renderCspValue(v, nonce)).join(" ");
}

function renderTrustedTypes(trustedTypes: TrustedTypesOptions): string {
  const names = trustedTypes.policies.length === 0 ? "'none'" : trustedTypes.policies.join(" ");
  return `trusted-types ${names}${trustedTypes.allowDuplicates ? " 'allow-duplicates'" : ""}`;
}

function buildCsp(
  nonce: string,
  directives: CspDirectiveOptions,
  reporting: CspReportingOptions | undefined,
  disposition: "enforce" | "report",
): string {
  const scriptSrc = resolveCspSources("scriptSrc", directives);
  const connectSrc = resolveCspSources("connectSrc", directives);
  const frameSrc = resolveCspSources("frameSrc", directives);
  const imgSrc = resolveCspSources("imgSrc", directives);
  const styleSrc = resolveCspSources("styleSrc", directives);
  const fontSrc = resolveCspSources("fontSrc", directives);

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
  ];
  if (disposition === "enforce") parts.push(`upgrade-insecure-requests`);
  if (directives.workerSrc) parts.push(`worker-src ${renderCspValues(directives.workerSrc, nonce)}`);
  if (directives.childSrc) parts.push(`child-src ${renderCspValues(directives.childSrc, nonce)}`);
  const { trustedTypes } = directives;
  if (trustedTypes && trustedTypes.require !== false) parts.push(`require-trusted-types-for 'script'`);
  if (trustedTypes) parts.push(renderTrustedTypes(trustedTypes));
  if (reporting) parts.push(`report-uri ${reporting.endpoint}`, `report-to ${reporting.group ?? CSP_REPORTING_GROUP_DEFAULT}`);
  return parts.join("; ");
}

// Unreachable to a caller: `CSP_SOURCE_TOKEN` is `/^[\x21-\x7e]+$/`, which excludes NUL.
const NONCE_PLACEHOLDER = "\0";

type HeaderEntry = readonly [string, string];

interface PrecomputedSecurityHeaders {
  cspEntries: readonly HeaderEntry[];
  staticEntries: readonly HeaderEntry[];
}

function precomputeCspHeaders(options: CspOptions): readonly HeaderEntry[] {
  const { reporting, reportOnly } = options;
  const entries: HeaderEntry[] = [["content-security-policy", buildCsp(NONCE_PLACEHOLDER, options, reporting, "enforce")]];
  if (reportOnly) {
    entries.push(["content-security-policy-report-only", buildCsp(NONCE_PLACEHOLDER, resolveReportOnly(options, reportOnly), reporting, "report")]);
  }
  if (reporting) entries.push(["reporting-endpoints", `${reporting.group ?? CSP_REPORTING_GROUP_DEFAULT}="${reporting.endpoint}"`]);
  return Object.freeze(entries);
}

function precomputeSecurityHeaders(options: SecurityHeadersOptions = {}): PrecomputedSecurityHeaders {
  const hsts = options.hsts ?? {};
  const entries: [string, string][] = [
    ...(hsts === false ? [] : [["strict-transport-security", buildHsts(hsts)] as [string, string]]),
    ["referrer-policy", options.referrerPolicy ?? "strict-origin-when-cross-origin"],
    ["x-content-type-options", "nosniff"],
    ["permissions-policy", buildPermissionsPolicy(options.permissionsPolicy)],
    ["x-frame-options", "DENY"],
    ["cross-origin-opener-policy", options.crossOriginOpenerPolicy ?? "same-origin"],
    ["cross-origin-resource-policy", options.crossOriginResourcePolicy ?? "same-origin"],
  ];
  // COEP is opt-in: `require-corp` breaks every subresource lacking CORP/CORS opt-in.
  if (options.crossOriginEmbedderPolicy) {
    entries.push(["cross-origin-embedder-policy", options.crossOriginEmbedderPolicy]);
  }
  return { cspEntries: precomputeCspHeaders(options), staticEntries: Object.freeze(entries) };
}

function renderCspHeaders(entries: readonly HeaderEntry[], nonce: string): HeaderEntry[] {
  return entries.map(([name, value]) => [name, value.replaceAll(NONCE_PLACEHOLDER, nonce)] as const);
}

function renderSecurityHeaders(precomputed: PrecomputedSecurityHeaders, nonce: string): HeaderEntry[] {
  return [...renderCspHeaders(precomputed.cspEntries, nonce), ...precomputed.staticEntries];
}

/** Applies forge's security headers to `response`, minting a nonce when `options.nonce` is omitted. @public */
export function applySecurityHeaders(response: Response, options?: ApplySecurityHeadersOptions): Response {
  const { nonce = generateNonce(), ...headerOptions } = options ?? {};
  if (!CSP_NONCE_VALUE.test(nonce)) {
    throw new Error("Invalid CSP nonce: must be a non-empty base64 or base64url value (no quotes, whitespace or CSP separators)");
  }
  assertValidSecurityHeadersOptions(headerOptions);
  const headers = new Headers(response.headers);
  const ownCsp = response.headers.get("content-security-policy");
  for (const [name, value] of renderSecurityHeaders(precomputeSecurityHeaders(headerOptions), nonce)) {
    headers.set(name, value);
  }
  if (ownCsp !== null) headers.append("content-security-policy", ownCsp);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Middleware applying CSP with a per-request nonce, HSTS, and the rest of forge's security headers. @public */
export function createSecurityHeaders(options?: SecurityHeadersOptions): Middleware {
  const base = options ?? {};
  assertValidSecurityHeadersOptions(base);
  const precomputed = precomputeSecurityHeaders(base);

  return async (context, next) => {
    const nonce = generateNonce();
    secureHeadersNonce.set(context, nonce);
    securityHeadersBase.set(context, base);

    // Queued before `next()` so the headers still reach the error page when anything deeper throws.
    for (const [name, value] of renderSecurityHeaders(precomputed, nonce)) {
      setPendingHeader(context, name, value);
    }

    return next();
  };
}

/** Route middleware laying `extra` over the app's CSP options and re-queuing the CSP family under the request's nonce. @public */
export function createRouteSecurityHeaders(extra: CspOptions): Middleware {
  assertValidSecurityHeadersOptions(extra);
  const precomputedByBase = new WeakMap<SecurityHeadersOptions, readonly HeaderEntry[]>();

  return async (context, next) => {
    const base = securityHeadersBase.getOptional(context);
    const nonce = secureHeadersNonce.getOptional(context);
    if (base === undefined || nonce === undefined) {
      throw new Error("createRouteSecurityHeaders: createSecurityHeaders must run earlier on this request");
    }
    let entries = precomputedByBase.get(base);
    if (!entries) {
      const merged = mergeSecurityHeaders(base, extra);
      assertValidSecurityHeadersOptions(merged);
      entries = precomputeCspHeaders(merged);
      precomputedByBase.set(base, entries);
    }
    for (const [name, value] of renderCspHeaders(entries, nonce)) {
      setPendingHeader(context, name, value);
    }
    return next();
  };
}
