import type { Middleware } from "@remix-run/fetch-router";
import { getAppContext } from "../context/types";
import { v } from "../validation/mod";

/** Validates an env object against a valibot schema; throws a descriptive error on failure. @public */
export function validateEnv<T>(env: unknown, schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>): T {
  const result = v.safeParse(schema, env);
  if (!result.success) {
    const issues = result.issues.map((issue) => `${issue.path?.map((p) => p.key).join(".") ?? "root"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.output;
}

/**
 * Middleware that validates Cloudflare Worker bindings on first request (or when the env changes).
 * Throws on failure; does not modify or store the env — use `context.env` directly. @public
 */
export function validateBindings(schema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>): Middleware {
  let cachedEnvRef: unknown;
  return async (context, next) => {
    const env = getAppContext(context).env;
    if (env !== cachedEnvRef) {
      validateEnv(env, schema);
      cachedEnvRef = env;
    }
    return next();
  };
}
