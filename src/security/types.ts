import type { ContentSecurityPolicyOptionHandler } from "hono/secure-headers";

type CspValue = (string | ContentSecurityPolicyOptionHandler)[];

export interface SecurityHeadersOptions {
  scriptSrc?: CspValue;
  connectSrc?: CspValue;
  frameSrc?: CspValue;
  imgSrc?: CspValue;
  workerSrc?: CspValue;
  childSrc?: CspValue;
  hstsMaxAge?: number;
}

export interface SecurityConfig {
  csrf?: { secret: CryptoKey; tokenField?: string; headerName?: string };
  origin?: { allowed: string[] };
  cop?: boolean;
  hxRequest?: boolean;
  contentType?: boolean;
}

/** Merge into your Hono app generic when using `csrfProtection` to type `c.get("csrfToken")`. @public */
export type CsrfVariables = { Variables: { csrfToken: string | undefined } };

export type CsrfResult =
  | { ok: true }
  | { ok: false; reason: "missing-token" | "invalid-format" | "expired" | "future-timestamp" | "path-mismatch" | "invalid-signature" };

export type OriginResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "disallowed" };
