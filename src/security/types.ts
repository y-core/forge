import type { ContentSecurityPolicyOptionHandler } from "hono/secure-headers";

type CspValue = (string | ContentSecurityPolicyOptionHandler)[];

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

export type OriginResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "disallowed" };
