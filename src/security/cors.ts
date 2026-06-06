import type { Middleware } from "@remix-run/fetch-router";
import type { CorsOptions } from "./types";

/** Pure function: tests whether an origin matches an exact string or a subdomain wildcard pattern. @public */
export function matchOrigin(origin: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      if (origin === pattern) return true;
      continue;
    }
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const rePattern = escaped.replace(/\*/g, "[^.]+");
    if (new RegExp(`^${rePattern}$`).test(origin)) return true;
  }
  return false;
}

/** Middleware that adds CORS response headers for allowed origins. @public */
export function cors(options: CorsOptions): Middleware {
  const {
    origins,
    methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders = ["Content-Type"],
    credentials = false,
    maxAge = 86400,
  } = options;

  if (credentials && origins.includes("*")) {
    throw new Error('cors: cannot use wildcard origin "*" with credentials: true');
  }

  const isAllowed = (origin: string): boolean => origins.includes("*") || matchOrigin(origin, origins);

  const resolveAcao = (origin: string): string => (origins.includes("*") && !credentials ? "*" : origin);

  return async (context, next) => {
    const origin = context.request.headers.get("Origin");

    // Preflight
    if (context.method === "OPTIONS" && context.request.headers.get("Access-Control-Request-Method") != null) {
      if (origin != null && isAllowed(origin)) {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": resolveAcao(origin),
            "Access-Control-Allow-Methods": methods.join(", "),
            "Access-Control-Allow-Headers": allowedHeaders.join(", "),
            "Access-Control-Max-Age": String(maxAge),
            ...(credentials ? { "Access-Control-Allow-Credentials": "true" } : {}),
            Vary: "Origin",
          },
        });
      }
      return new Response(null, { status: 204 });
    }

    const res = await next();

    if (origin != null && isAllowed(origin)) {
      // Rebuild rather than mutate: the downstream response's headers may be immutable (e.g. a
      // cached or constructed Response), and in-place mutation would silently throw or no-op.
      const headers = new Headers(res.headers);
      headers.set("Access-Control-Allow-Origin", resolveAcao(origin));
      if (credentials) headers.set("Access-Control-Allow-Credentials", "true");
      headers.set("Vary", "Origin");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
    return res;
  };
}
