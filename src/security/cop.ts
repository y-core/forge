import type { MiddlewareHandler } from "hono";

type CopResult = { ok: true } | { ok: false; reason: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

export function checkCrossOriginProtection(request: Request): CopResult {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return { ok: true };
  }

  const secFetchSite = request.headers.get("Sec-Fetch-Site");

  if (secFetchSite === null) {
    // Non-browser client (no Fetch Metadata headers) — allow for interop
    return { ok: true };
  }

  if (secFetchSite === "cross-site") {
    return { ok: false, reason: "cross-site" };
  }

  // "same-origin" | "same-site" | "none" (direct navigation) → allow
  return { ok: true };
}

export function crossOriginProtection(): MiddlewareHandler {
  return async (c, next) => {
    const result = checkCrossOriginProtection(c.req.raw);
    if (!result.ok) {
      return c.text("Forbidden", 403);
    }
    return next();
  };
}
