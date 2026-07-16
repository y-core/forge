import type { AppContext } from "../context/types";
import type { GuardResult } from "../result/result";
import type { NONCE } from "./nonce";

/** A single CSP source value — a string literal or the `NONCE` placeholder. @public */
export type CspSourceValue = string | typeof NONCE;

type CspValue = CspSourceValue[];

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

export interface SecurityHeadersOptions {
  scriptSrc?: CspValue;
  connectSrc?: CspValue;
  frameSrc?: CspValue;
  imgSrc?: CspValue;
  workerSrc?: CspValue;
  childSrc?: CspValue;
  hstsMaxAge?: number;
  permissionsPolicy?: PermissionsPolicyOptions;
  /** Cross-Origin-Opener-Policy. `same-origin` isolates the browsing context group; use
   *  `same-origin-allow-popups` if the app opens OAuth/payment popups that must retain a
   *  window reference. @defaultValue "same-origin" */
  crossOriginOpenerPolicy?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
  /** Cross-Origin-Resource-Policy. `same-origin` blocks other origins from embedding this
   *  Worker's responses; use `cross-origin` for intentionally embeddable assets/APIs.
   *  @defaultValue "same-origin" */
  crossOriginResourcePolicy?: "same-origin" | "same-site" | "cross-origin";
  /** Cross-Origin-Embedder-Policy. Opt-in only — `require-corp` breaks any subresource
   *  without CORP/CORS opt-in, so forge never sets it by default. */
  crossOriginEmbedderPolicy?: "require-corp" | "credentialless";
}

/** `SecurityHeadersOptions` plus an explicit CSP nonce for `applySecurityHeaders`. @public */
export interface ApplySecurityHeadersOptions extends SecurityHeadersOptions {
  /** CSP nonce to embed; a fresh nonce is minted when omitted. */
  nonce?: string;
}

/** Result of an Origin/Referer allowlist check. @public */
export type OriginResult = GuardResult<"missing" | "disallowed">;

export interface DeriveAllowedOriginsOptions {
  /** When true, adds the `www.` variant for non-www hostnames. Defaults to false. */
  includeWww?: boolean;
}

/** Result of the Fetch-Metadata cross-origin check (`checkCrossOriginProtection`). @public */
export type CrossOriginResult = GuardResult<"missing-fetch-metadata" | "cross-site">;

export interface CrossOriginProtectionOptions {
  /** When true, allows requests with no Sec-Fetch-Site header. Defaults to false (fail-closed). */
  allowMissingHeader?: boolean;
}

export interface OriginProtectionOptions<Bindings = Record<string, unknown>> {
  /** Allowed origins for the Origin/Referer fallback (applied only when Sec-Fetch-Site is
   *  absent). A static list, or a per-request resolver over the app context (e.g. parsed
   *  BASE_URL config). */
  allowedOrigins: string[] | ((c: AppContext<Bindings>) => string[]);
}

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitOptions<Bindings = Record<string, unknown>> {
  limiter: (c: AppContext<Bindings>) => RateLimitBinding | undefined;
  key?: (c: AppContext<Bindings>) => string;
  onLimit?: (c: AppContext<Bindings>) => Response | Promise<Response>;
  /** When true (default), returns 503 if the binding is absent. */
  required?: boolean;
  /** When true, the default key reads the `CF-Connecting-IP` header (only trustworthy behind
   *  Cloudflare). Defaults to false (default-distrust): without a custom `key` the default keying
   *  throws. A custom `key` always overrides regardless of this flag. */
  trustCfHeaders?: boolean;
}

export interface CorsOptions {
  /** Exact allowed origins or subdomain patterns ("https://*.example.com"). */
  origins: string[];
  methods?: string[];
  allowedHeaders?: string[];
  credentials?: boolean;
  /** Preflight cache duration in seconds. @defaultValue 86400 */
  maxAge?: number;
}

/** Bare variable record set by `requestId`. @public */
export type RequestIdContext = { requestId: string };
