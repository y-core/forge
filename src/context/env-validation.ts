import type { Middleware } from "@remix-run/fetch-router";

import { safeCheck, v } from "../validation/mod";
import { parseEnv } from "../validation/parse-env";
import { getAppContext } from "./types";

/** Validates an env object against a valibot schema; throws a descriptive error on failure. @public */
export function validateEnv<T>(env: unknown, schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>): T {
  return parseEnv(schema, env);
}

/** Middleware that validates Worker bindings against a schema on first request, or when the env changes. @public */
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

/** One binding's declared shape. @public */
export interface BindingSpec {
  /** The key the binding is reached under on `env`. */
  name: string;
  /** Method names the binding must carry; the check is a shape check, not a presence check. */
  methods: readonly string[];
  /** How the binding is named in the failure message — `${name} must be ${label}`. */
  label: string;
  /** An absent binding passes; a present one of the wrong shape still fails. */
  optional?: boolean | undefined;
}

/** The one entry both forms build, so a required and an optional binding cannot diverge. */
function bindingEntry(spec: BindingSpec): v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>> {
  // `safeCheck`, not `v.check`: the message names the binding and its kind and never the value, so
  // the failure reads `LOGS_KV must be …` instead of the bare issue type `check`.
  const shape = v.pipe(
    v.unknown(),
    safeCheck(
      (val) =>
        typeof val === "object" && val !== null && spec.methods.every((method) => typeof (val as Record<string, unknown>)[method] === "function"),
      `${spec.name} must be ${spec.label}`,
    ),
  );
  return spec.optional === true ? v.optional(shape) : shape;
}

/** Builds the schema one binding validator checks: the named binding carries every method in `methods`. @public */
export function bindingSchema(
  name: string,
  methods: readonly string[],
  label: string,
  options: { optional?: boolean | undefined } = {},
): v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>> {
  return v.object({ [name]: bindingEntry({ name, methods, label, optional: options.optional }) });
}

/** Builds one schema covering several bindings, so an env is validated in a single pass. @public */
export function bindingSetSchema(specs: readonly BindingSpec[]): v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>> {
  return v.object(Object.fromEntries(specs.map((spec) => [spec.name, bindingEntry(spec)])));
}
