import type { AppContext } from "../context/types";
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

export interface SecurityHeadersOptions {
  scriptSrc?: CspValue;
  connectSrc?: CspValue;
  frameSrc?: CspValue;
  imgSrc?: CspValue;
  workerSrc?: CspValue;
  childSrc?: CspValue;
  hstsMaxAge?: number;
}

export type OriginResult = { ok: true } | { ok: false; reason: "missing" | "disallowed" };

export interface DeriveAllowedOriginsOptions {
  /** When true, adds the `www.` variant for non-www hostnames. Defaults to false. */
  includeWww?: boolean;
}

export type CopResult = { ok: true } | { ok: false; reason: string };

export interface CrossOriginProtectionOptions {
  /** When true, allows requests with no Sec-Fetch-Site header. Defaults to false (fail-closed). */
  allowMissingHeader?: boolean;
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
