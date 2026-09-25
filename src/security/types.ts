import type { AppContext } from "../context/types";
import type { DevAllowance } from "../dev/types";
import type { GuardResult } from "../result/types";
import type { NONCE } from "./nonce";
import type { UNSAFE_CSP_SOURCES } from "./unsafe";

/** A deliberate CSP weakening a caller opts into by importing it; the string spelling is refused. @public */
export type UnsafeCspSource = (typeof UNSAFE_CSP_SOURCES)[number]["placeholder"];

/** A single CSP source value — a string literal, the `NONCE` placeholder, or a deliberate unsafe opt-out. @public */
export type CspSourceValue = string | typeof NONCE | UnsafeCspSource;

type CspValue = CspSourceValue[];

/** Parsed URL parts (origin, hostname, protocol) derived from a base URL. @public */
export interface ParsedUrl {
  origin: string;
  hostname: string;
  protocol: string;
}

/** Extended parsed URL with derived allowed origins for CORS/origin checks. @public */
export interface BaseUrlConfig extends ParsedUrl {
  allowedOrigins: string[];
}

/** Permissions-Policy allowlists; omitted features default to `()` (disabled). @public */
export interface PermissionsPolicyOptions {
  microphone?: string[];
  camera?: string[];
  geolocation?: string[];
  payment?: string[];
}

/** Strict-Transport-Security tokens; each omitted field keeps forge's default of two years, `includeSubDomains` and `preload`. @public */
export interface HstsOptions {
  /** Seconds the browser holds the policy; a non-negative integer. */
  maxAge?: number | undefined;
  includeSubDomains?: boolean | undefined;
  /** Consent to the browsers' preload list, which takes months to leave again. */
  preload?: boolean | undefined;
}

/** CSP source lists, HSTS, Permissions-Policy, and cross-origin policy options for security headers. @public */
export interface SecurityHeadersOptions {
  scriptSrc?: CspValue;
  connectSrc?: CspValue;
  frameSrc?: CspValue;
  imgSrc?: CspValue;
  styleSrc?: CspValue;
  fontSrc?: CspValue;
  workerSrc?: CspValue;
  childSrc?: CspValue;
  /** `false` omits the header. */
  hsts?: false | HstsOptions;
  permissionsPolicy?: PermissionsPolicyOptions;
  crossOriginOpenerPolicy?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
  crossOriginResourcePolicy?: "same-origin" | "same-site" | "cross-origin";
  crossOriginEmbedderPolicy?: "require-corp" | "credentialless";
}

/** `SecurityHeadersOptions` plus an explicit CSP nonce for `applySecurityHeaders`. @public */
export interface ApplySecurityHeadersOptions extends SecurityHeadersOptions {
  nonce?: string;
}

/** Result of an Origin/Referer allowlist check. @public */
export type OriginResult = GuardResult<"missing" | "disallowed">;

/** Options controlling how allowed origins are derived from a base URL. @public */
export interface DeriveAllowedOriginsOptions {
  includeWww?: boolean;
  /** A development entry's token: its `extraOrigins` are appended to the derived set. */
  dev?: DevAllowance;
}

/** Result of the Fetch-Metadata cross-origin check (`checkCrossOriginProtection`). @public */
export type CrossOriginResult = GuardResult<"missing-fetch-metadata" | "cross-site" | "same-site">;

/** Options for the Fetch-Metadata cross-origin protection guard. @public */
export interface CrossOriginProtectionOptions {
  /** A development entry's token: with `missingFetchMetadata` a request carrying no `Sec-Fetch-Site` header is accepted. Absent, the guard fails closed. */
  dev?: DevAllowance;
}

/** Options for the Origin/Referer allowlist middleware, with per-request origin resolution. @public */
export interface OriginProtectionOptions<Bindings = Record<string, unknown>> {
  /** The app's own origin must appear here, or its own same-origin mutations are rejected. */
  allowedOrigins: string[] | ((c: AppContext<Bindings>) => string[]);
}

/** Cloudflare rate-limit binding shape exposing a keyed `limit()` call. @public */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Options for the rate-limit middleware: binding resolver, keying, and over-limit handling. @public */
export interface RateLimitOptions<Bindings = Record<string, unknown>> {
  limiter: (c: AppContext<Bindings>) => RateLimitBinding | undefined;
  key?: (c: AppContext<Bindings>) => string;
  onLimit?: (c: AppContext<Bindings>) => Response | Promise<Response>;
  /** A development entry's token: with `rateLimitOptional` an absent binding is skipped instead of answering 503. */
  dev?: DevAllowance;
  /** Opts the default keying into `CF-Connecting-IP`, trustworthy only behind Cloudflare; without it and without a `key`, keying throws. */
  trustCfHeaders?: boolean;
}

/** CORS middleware options: allowed origins, methods, headers, credentials, and preflight cache. @public */
export interface CorsOptions {
  /** Exact allowed origins or subdomain patterns ("https://*.example.com"). */
  origins: string[];
  methods?: string[];
  allowedHeaders?: string[];
  credentials?: boolean;
  /** Preflight cache duration in seconds. */
  maxAge?: number;
}

/** Bare variable record set by `requestId`. @public */
export type RequestIdContext = { requestId: string };
