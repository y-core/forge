import type { MiddlewareHandler } from "hono";
import { NONCE, secureHeaders } from "hono/secure-headers";
import type { SecurityHeadersOptions } from "./types";

/** Middleware factory that applies CSP, HSTS, referrer-policy, and permissions-policy headers. @public */
export function makeSecurityHeaders(options?: SecurityHeadersOptions): MiddlewareHandler {
  const { hstsMaxAge = 63072000 } = options ?? {};

  const scriptSrc = options?.scriptSrc ?? ["'self'", NONCE];
  const connectSrc = options?.connectSrc ?? ["'self'"];
  const frameSrc = options?.frameSrc ?? ["'self'"];
  const imgSrc = options?.imgSrc ?? ["'self'", "data:"];

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
