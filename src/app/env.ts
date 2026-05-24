import type { MiddlewareHandler } from "hono";
import { v } from "../validation/mod";

/**
 * Hono env type that adds the validated bindings variable. Merge with your own
 * `{ Bindings: YourRawEnv }` to get typed `c.get("bindings")` access.
 * Does NOT type `c.env` — that stays whatever Bindings type you declare.
 * @public
 */
export type ValidatedEnv<T extends object> = {
  Bindings: Record<string, unknown>;
  Variables: { bindings: Readonly<T> };
};

/** Validates an env object against a valibot schema; throws a descriptive error on failure. @public */
export function validateEnv<T>(
  env: unknown,
  schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>,
): T {
  const result = v.safeParse(schema, env);
  if (!result.success) {
    const issues = result.issues
      .map((issue) => `${issue.path?.map((p) => p.key).join(".") ?? "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.output;
}

/**
 * Middleware that validates and caches Cloudflare Worker bindings on first request,
 * then exposes the validated (and transformed) result via `c.get("bindings")`.
 * @public
 */
export function resolveBindings<T extends object>(
  schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>,
): MiddlewareHandler<ValidatedEnv<T>> {
  let cached: Readonly<T> | undefined;
  return async (c, next) => {
    if (!cached) {
      cached = Object.freeze(validateEnv(c.env, schema));
    }
    c.set("bindings", cached);
    await next();
  };
}
