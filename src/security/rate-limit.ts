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
        "Set `trustCfHeaders: true` when running behind Cloudflare, or pass a `key` option for non-Cloudflare deployments.",
    );
  }
  return ip;
}

function defaultOnLimit(): Response {
  return new Response(DEFAULT_MESSAGE, { status: 429 });
}

/** Middleware enforcing a Cloudflare rate-limit binding, returning 503 when the binding is absent unless `required: false`. @public */
export function rateLimit<Bindings = Record<string, unknown>>(options: RateLimitOptions<Bindings>): Middleware {
  const logger = createLogger("rate-limit");
  const limiter = options.limiter;
  const defaultKeyResolver: (c: AppContext<Bindings>) => string = options.trustCfHeaders
    ? (defaultKey as (c: AppContext<Bindings>) => string)
    : () => {
        throw new Error(
          "rateLimit: refusing to key by CF-Connecting-IP without `trustCfHeaders: true`. " +
            "Set `trustCfHeaders: true` when running behind Cloudflare, or pass a `key` option for non-Cloudflare deployments.",
        );
      };
  const key: (c: AppContext<Bindings>) => string = options.key ?? defaultKeyResolver;
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
