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

export type OriginResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "disallowed" };
