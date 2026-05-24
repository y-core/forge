import type { MiddlewareHandler } from "hono";
import { v } from "../validation/mod";

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

/** Middleware that validates and caches Cloudflare Worker bindings on first request. @public */
export function resolveBindings<T extends object>(
  schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>,
): MiddlewareHandler<{ Bindings: T }> {
  let cached: T | undefined;
  return async (c, next) => {
    if (!cached) {
      cached = validateEnv(c.env, schema);
    }
    await next();
  };
}
