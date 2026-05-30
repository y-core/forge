import type { MiddlewareHandler } from "hono";

type CopResult = { ok: true } | { ok: false; reason: string };

export interface CrossOriginProtectionOptions {
  /** When true, allows requests with no Sec-Fetch-Site header (e.g. server-to-server API clients). Defaults to false (fail-closed). */
  allowMissingHeader?: boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

/** Pure function: inspects Sec-Fetch-Site to detect cross-site mutations. @public */
export function checkCrossOriginProtection(
  request: Request,
  options: CrossOriginProtectionOptions = {},
): CopResult {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return { ok: true };
  }

  const secFetchSite = request.headers.get("Sec-Fetch-Site");

  if (secFetchSite === null) {
    if (options.allowMissingHeader) {
      return { ok: true };
    }
    return { ok: false, reason: "missing-fetch-metadata" };
  }

  if (secFetchSite === "cross-site") {
    return { ok: false, reason: "cross-site" };
  }

  // "same-origin" | "same-site" | "none" (direct navigation) → allow
  return { ok: true };
}

/** Middleware that rejects cross-site mutation requests detected via Fetch Metadata (403). @public */
export function crossOriginProtection(
  options: CrossOriginProtectionOptions = {},
): MiddlewareHandler {
  return async (c, next) => {
    const result = checkCrossOriginProtection(c.req.raw, options);
    if (!result.ok) {
      return c.text("Forbidden", 403);
    }
    return next();
  };
}
