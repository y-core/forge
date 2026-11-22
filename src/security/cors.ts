import type { Middleware, RequestContext } from "@remix-run/fetch-router";

import { memoizePerEnv } from "../context/env-memo";
import { rebuildResponse } from "../http/rebuild";
import type { CorsOptions } from "./types";

const HEADER_NAME_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

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
export function matchOrigin(origin: string, patterns: readonly string[]): boolean {
  return compileOriginMatcher(patterns)(origin);
}

interface OriginPolicy {
  readonly acaoConstant: "*" | undefined;
  readonly isAllowed: (origin: string) => boolean;
}

function compileOriginPolicy(origins: readonly string[], credentials: boolean): OriginPolicy {
  const wildcard = origins.includes("*");
  if (credentials && wildcard) {
    throw new Error('cors: cannot use wildcard origin "*" with credentials: true');
  }
  const matchesOrigin = compileOriginMatcher(origins);
  return { acaoConstant: wildcard ? "*" : undefined, isAllowed: (origin) => wildcard || matchesOrigin(origin) };
}

function originPolicySource<Bindings>(
  origins: CorsOptions<Bindings>["origins"],
  credentials: boolean,
): OriginPolicy | ((context: RequestContext) => Promise<OriginPolicy>) {
  if (typeof origins !== "function") return compileOriginPolicy(origins, credentials);
  return memoizePerEnv(async (env: Bindings) => compileOriginPolicy(await origins(env), credentials));
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

function refuseNonTokenHeaderNames(option: string, names: readonly string[], header: string): void {
  for (const name of names) {
    if (!HEADER_NAME_TOKEN.test(name)) {
      throw new Error(
        `cors: ${option} entry ${JSON.stringify(name)} is not a header name — an RFC 9110 token has no whitespace, comma or control character, and one that did would split or corrupt ${header}.`,
      );
    }
  }
}

/** Middleware that adds CORS response headers for allowed origins. @public */
export function cors<Bindings = Record<string, unknown>>(options: CorsOptions<Bindings>): Middleware {
  const {
    origins,
    methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders = ["Content-Type"],
    exposedHeaders = [],
    credentials = false,
    maxAge = 86400,
  } = options;

  const policySource = originPolicySource(origins, credentials);
  refuseNonTokenHeaderNames("allowedHeaders", allowedHeaders, "Access-Control-Allow-Headers");
  refuseNonTokenHeaderNames("exposedHeaders", exposedHeaders, "Access-Control-Expose-Headers");
  if (credentials && exposedHeaders.includes("*")) {
    throw new Error(
      'cors: cannot use wildcard exposedHeaders "*" with credentials: true — a credentialed response reads "*" as a header named "*", so it would expose nothing.',
    );
  }
  const exposeHeaderValue = exposedHeaders.length > 0 ? exposedHeaders.join(", ") : undefined;

  // A constant `*` answers every caller alike, so `Vary: Origin` would only shred the cache key.
  // Every other configuration answers per origin — including the refusal a cache could replay.
  const variesOnOrigin = typeof policySource === "function" || policySource.acaoConstant === undefined;

  const preflightHeaders: Record<string, string> = {
    "Access-Control-Allow-Methods": methods.join(", "),
    "Access-Control-Allow-Headers": allowedHeaders.join(", "),
    "Access-Control-Max-Age": String(maxAge),
    ...(credentials ? { "Access-Control-Allow-Credentials": "true" } : {}),
    ...(variesOnOrigin ? { Vary: "Origin" } : {}),
  };

  return async (context, next) => {
    const { acaoConstant, isAllowed } = typeof policySource === "function" ? await policySource(context) : policySource;
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
      if (exposeHeaderValue !== undefined) headers.set("Access-Control-Expose-Headers", exposeHeaderValue);
    }
    if (variesOnOrigin) appendVary(headers, "Origin");
    return rebuildResponse(res, headers);
  };
}
