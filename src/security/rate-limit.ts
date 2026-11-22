import type { Middleware } from "@remix-run/fetch-router";

import { admitsAbsentLimiter } from "#relax/rate-limit";

import { contextVar } from "../context/accessor";
import { matchedRoutePattern } from "../context/route-pattern";
import type { AppContext } from "../context/types";
import { getAppContext } from "../context/types";
import { createRefusalAnswer } from "./refusal";
import { cfHeadersTrustedCtx } from "./request-id";
import type { RateLimit, RateLimitCheck, RateLimitOptions, RateLimitTable, RelaxAbsentLimiter } from "./types";

/** The rate-limit windows the chain declared, published for every limit on the request to check its binding name against. @internal */
export const rateLimitsCtx = contextVar<RateLimitTable>("rateLimits");

function defaultKey(c: AppContext<object>): string {
  if (cfHeadersTrustedCtx.getOptional(c) !== true) {
    throw new Error(
      "rateLimit: refusing to key by CF-Connecting-IP, since no chain declared trust in Cloudflare headers. " +
        "Set `trustCfHeaders: true` on `applyMiddlewareChain` when running behind Cloudflare, or pass a `key` option for non-Cloudflare deployments.",
    );
  }
  const ip = c.request.headers.get("CF-Connecting-IP");
  if (!ip) throw new Error("rateLimit: CF-Connecting-IP header is absent and no custom key function was provided.");
  return ip;
}

/** Middleware enforcing a Cloudflare rate-limit binding, refusing 429 past the limit and 503 when the binding is absent unless a development build admits its absence. @public */
export function rateLimit<Bindings = Record<string, unknown>>(options: RateLimitOptions<Bindings>): Middleware {
  return limitRequests(options, admitsAbsentLimiter);
}

/** A `keySuffix` that keys per route rather than per URL: the matched pattern source, or one constant for every request no route matches. @public */
export function routeKeySuffix<Bindings>(c: AppContext<Bindings>): string {
  return matchedRoutePattern.getOptional(c) ?? "<unmatched>";
}

/** `rateLimit` as a route's guard-step check rather than a middleware. @internal */
export function rateLimitCheck<Bindings = Record<string, unknown>>(options: RateLimitOptions<Bindings>): RateLimitCheck {
  return createLimitCheck(options, admitsAbsentLimiter);
}

/** `rateLimit` with the absent-binding relaxation passed in. @internal */
export function limitRequests<Bindings = Record<string, unknown>>(
  options: RateLimitOptions<Bindings>,
  admitsAbsent: RelaxAbsentLimiter,
): Middleware {
  const check = createLimitCheck(options, admitsAbsent);
  return async (context, next) => (await check(context)) ?? next();
}

function createLimitCheck<Bindings>(options: RateLimitOptions<Bindings>, admitsAbsent: RelaxAbsentLimiter): RateLimitCheck {
  const { binding: name } = options;
  const counted = options.methods === undefined ? null : new Set(options.methods.map((method) => method.toUpperCase()));
  const trustedIpKey = defaultKey as (c: AppContext<Bindings>) => string;
  const { keySuffix } = options;
  if (keySuffix && options.key) {
    throw new Error("rateLimit: `key` and `keySuffix` are exclusive. Pass `keySuffix` to extend the client-IP key, or `key` to replace it.");
  }
  const key: (c: AppContext<Bindings>) => string = options.key ?? (keySuffix ? (c) => `${trustedIpKey(c)}:${keySuffix(c)}` : trustedIpKey);
  const refuse = createRefusalAnswer<Bindings>(options.onRefuse);

  return async (context) => {
    const table = rateLimitsCtx.getOptional(context);
    if (table !== undefined && !Object.hasOwn(table, name)) {
      throw new Error(
        `rateLimit: the binding "${name}" is not in the chain's \`rateLimits\` — declare it in wrangler.jsonc's \`ratelimits\` and regenerate RATELIMITS, or correct the name.`,
      );
    }
    if (counted !== null && !counted.has(context.request.method)) return undefined;
    const c = getAppContext<Bindings>(context);
    const binding = (c.env as Record<string, RateLimit | undefined>)[name];
    if (!binding) {
      if (admitsAbsent()) return undefined;
      return refuse(context, { guard: "rate-limit", status: 503, reason: "binding-absent" });
    }
    let resolvedKey: string;
    try {
      resolvedKey = key(c);
    } catch (error) {
      return refuse(context, { guard: "rate-limit", status: 503, reason: "key-failed" }, error);
    }
    let outcome: { success: boolean };
    try {
      outcome = await binding.limit({ key: resolvedKey });
    } catch (error) {
      return refuse(context, { guard: "rate-limit", status: 503, reason: "binding-failed" }, error);
    }
    if (!outcome.success) {
      const period = table?.[name]?.period;
      return refuse(context, { guard: "rate-limit", status: 429, ...(period === undefined ? {} : { retryAfter: period }) });
    }
    return undefined;
  };
}
