import type { MiddlewareHandler } from "hono";

export interface CorsOptions {
  /** Explicit allowed origins. Exact match or subdomain pattern ("https://*.example.com").
   *  No literal "*" when credentials is true. */
  origins: string[];
  methods?: string[];
  allowedHeaders?: string[];
  credentials?: boolean;
  /** Preflight cache duration in seconds. @defaultValue 86400 */
  maxAge?: number;
}

/** Pure function: tests whether an origin matches an exact string or a subdomain wildcard pattern. @public */
export function matchOrigin(origin: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      if (origin === pattern) return true;
      continue;
    }
    // Escape metacharacters (excluding *), then replace * with [^.]+ (single DNS label)
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const rePattern = escaped.replace(/\*/g, "[^.]+");
    if (new RegExp(`^${rePattern}$`).test(origin)) return true;
  }
  return false;
}

/** Middleware that adds CORS response headers for allowed origins. @public */
export function cors(options: CorsOptions): MiddlewareHandler {
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

  const isAllowed = (origin: string): boolean =>
    origins.includes("*") || matchOrigin(origin, origins);

  const resolveAcao = (origin: string): string =>
    origins.includes("*") && !credentials ? "*" : origin;

  return async (c, next) => {
    const origin = c.req.header("Origin");

    // Preflight
    if (c.req.method === "OPTIONS" && c.req.header("Access-Control-Request-Method") != null) {
      if (origin != null && isAllowed(origin)) {
        c.header("Access-Control-Allow-Origin", resolveAcao(origin));
        c.header("Access-Control-Allow-Methods", methods.join(", "));
        c.header("Access-Control-Allow-Headers", allowedHeaders.join(", "));
        c.header("Access-Control-Max-Age", String(maxAge));
        if (credentials) c.header("Access-Control-Allow-Credentials", "true");
        c.header("Vary", "Origin");
      }
      return c.body(null, 204);
    }

    await next();

    if (origin != null && isAllowed(origin)) {
      c.header("Access-Control-Allow-Origin", resolveAcao(origin));
      if (credentials) c.header("Access-Control-Allow-Credentials", "true");
      c.header("Vary", "Origin");
    }
  };
}
