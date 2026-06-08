import type { Middleware } from "@remix-run/fetch-router";
import type { AppContext } from "../context/types";
import { getAppContext } from "../context/types";
import { createLogger } from "../logging/logger";
import type { RateLimitOptions } from "./types";

const DEFAULT_MESSAGE = "Too many requests. Please try again later.";

function defaultKey(c: AppContext<object>): string {
  const ip = c.request.headers.get("CF-Connecting-IP");
  if (!ip) {
    throw new Error(
      "rateLimit: CF-Connecting-IP header is absent and no custom key function was provided. " +
        "Pass a `key` option for non-Cloudflare deployments.",
    );
  }
  return ip;
}

function defaultOnLimit(): Response {
  return new Response(DEFAULT_MESSAGE, { status: 429 });
}

/**
 * Middleware that enforces Cloudflare rate-limit bindings; returns 503 when binding is absent
 * unless `required: false`.
 *
 * @remarks
 * The default key is the `CF-Connecting-IP` header, which is only trustworthy when the Worker runs
 * behind Cloudflare — on other platforms (or a directly-reachable origin) a client can forge it to
 * evade or poison the limit. For non-Cloudflare deployments always supply a custom `key`. @public
 */
export function rateLimit<Bindings = Record<string, unknown>>(options: RateLimitOptions<Bindings>): Middleware {
  const logger = createLogger("rate-limit");
  const limiter = options.limiter;
  const key: (c: AppContext<Bindings>) => string = options.key ?? (defaultKey as (c: AppContext<Bindings>) => string);
  const onLimit: (c: AppContext<Bindings>) => Response | Promise<Response> = options.onLimit ?? defaultOnLimit;
  const required = options.required !== false;

  return async (context, next) => {
    const c = getAppContext<Bindings>(context);
    const binding = limiter(c);
    if (!binding) {
      if (!required) {
        logger.warn("Rate limiter binding not configured — skipping");
        return next();
      }
      return new Response("Service unavailable", { status: 503 });
    }
    let resolvedKey: string;
    try {
      resolvedKey = key(c);
    } catch {
      return new Response("Service unavailable", { status: 503 });
    }
    const { success } = await binding.limit({ key: resolvedKey });
    if (!success) {
      return onLimit(c);
    }
    return next();
  };
}
