import type { Middleware } from "@remix-run/fetch-router";

import type { CorsOptions } from "./types";

/** Compiles origin patterns once into an exact-match set plus the wildcard patterns' regexes. */
function compileOriginMatcher(patterns: readonly string[]): (origin: string) => boolean {
  const exact = new Set<string>();
  const regexes: RegExp[] = [];
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      exact.add(pattern);
      continue;
    }
    // `?` must be escaped too — unescaped it makes the preceding character optional, silently
    // widening the pattern.
    const escaped = pattern.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
    // The excluded delimiters are load-bearing: with `[^.]+`, `https://a/b.example.com` matches
    // `https://*.example.com` and is reflected into Access-Control-Allow-Origin.
    regexes.push(new RegExp(`^${escaped.replace(/\*/g, "[^./:@?#]+")}$`));
  }
  return (origin) => exact.has(origin) || regexes.some((re) => re.test(origin));
}

/** Pure function: tests whether an origin matches an exact string or a subdomain wildcard pattern. @public */
export function matchOrigin(origin: string, patterns: string[]): boolean {
  return compileOriginMatcher(patterns)(origin);
}

function appendVary(headers: Headers, token: string): void {
  const existing = headers.get("Vary");
  if (existing == null || existing.trim() === "") {
    headers.set("Vary", token);
    return;
  }
  if (existing.trim() === "*") return; // Vary: * already means "varies on everything"
  const present = existing.split(",").some((t) => t.trim().toLowerCase() === token.toLowerCase());
  if (!present) headers.set("Vary", `${existing}, ${token}`);
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

  const wildcard = origins.includes("*");
  const matchesOrigin = compileOriginMatcher(origins);
  const isAllowed = (origin: string): boolean => wildcard || matchesOrigin(origin);

  // A constant `*` answers every caller alike, so `Vary: Origin` would only shred the cache key.
  // Every other configuration answers per origin — including the refusal a cache could replay.
  const acaoConstant = wildcard && !credentials ? "*" : undefined;
  const variesOnOrigin = acaoConstant === undefined;

  const preflightHeaders: Record<string, string> = {
    "Access-Control-Allow-Methods": methods.join(", "),
    "Access-Control-Allow-Headers": allowedHeaders.join(", "),
    "Access-Control-Max-Age": String(maxAge),
    ...(credentials ? { "Access-Control-Allow-Credentials": "true" } : {}),
    ...(variesOnOrigin ? { Vary: "Origin" } : {}),
  };

  return async (context, next) => {
    const origin = context.request.headers.get("Origin");

    if (context.method === "OPTIONS" && context.request.headers.get("Access-Control-Request-Method") != null) {
      if (origin != null && isAllowed(origin)) {
        return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": acaoConstant ?? origin, ...preflightHeaders } });
      }
      return new Response(null, { status: 204, headers: variesOnOrigin ? { Vary: "Origin" } : {} });
    }

    const res = await next();
    const allowed = origin != null && isAllowed(origin);
    if (!allowed && !variesOnOrigin) return res;

    // Rebuild rather than mutate: a downstream response's headers may be immutable.
    const headers = new Headers(res.headers);
    if (allowed) {
      headers.set("Access-Control-Allow-Origin", acaoConstant ?? origin);
      if (credentials) headers.set("Access-Control-Allow-Credentials", "true");
    }
    if (variesOnOrigin) appendVary(headers, "Origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
