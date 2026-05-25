import type { Context, Env, MiddlewareHandler } from "hono";
import { createLogger } from "../logging/logger";

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitOptions<E extends Env = Env> {
  limiter: (c: Context<E>) => RateLimitBinding | undefined;
  key?: (c: Context<E>) => string;
  onLimit?: (c: Context<E>) => Response | Promise<Response>;
  /** When true (default), returns 503 if the binding is absent. Set false to warn-and-skip instead. */
  required?: boolean;
}

const DEFAULT_MESSAGE = "Too many requests. Please try again later.";

function defaultKey(c: Context): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

function defaultOnLimit(): Response {
  return new Response(DEFAULT_MESSAGE, { status: 429 });
}

/** Middleware that enforces Cloudflare rate-limit bindings; returns 503 when binding is absent unless `required: false`. @public */
export function rateLimit<E extends Env = Env>(options: RateLimitOptions<E>): MiddlewareHandler<E> {
  const logger = createLogger("rate-limit");
  const limiter = options.limiter;
  const key: (c: Context<E>) => string = options.key ?? (defaultKey as (c: Context<E>) => string);
  const onLimit: (c: Context<E>) => Response | Promise<Response> = options.onLimit ?? defaultOnLimit;
  const required = options.required !== false;

  return async (c, next) => {
    const binding = limiter(c);
    if (!binding) {
      if (!required) {
        logger.warn("Rate limiter binding not configured — skipping");
        return next();
      }
      return new Response("Service unavailable", { status: 503 });
    }
    const { success } = await binding.limit({ key: key(c) });
    if (!success) {
      return onLimit(c);
    }
    return next();
  };
}
