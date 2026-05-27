import type { MiddlewareHandler } from "hono";
import { v } from "../validation/mod";

/** Validates an env object against a valibot schema; throws a descriptive error on failure.
 * @public
 */
export function validateEnv<T>(env: unknown, schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>): T {
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
 * Middleware that validates Cloudflare Worker bindings on first request (or when the env
 * reference changes). Throws on failure; does not modify or store the env — use `c.env` directly.
 * Cache is keyed by `c.env` object identity: re-validates only when the env reference changes,
 * which allows tests to pass different env objects per request.
 * @public
 */
export function validateBindings(schema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>): MiddlewareHandler {
  let cachedEnvRef: unknown;
  return async (c, next) => {
    if (c.env !== cachedEnvRef) {
      validateEnv(c.env, schema);
      cachedEnvRef = c.env;
    }
    await next();
  };
}
