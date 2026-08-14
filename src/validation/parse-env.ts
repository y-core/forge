import { formatValidationIssues } from "./format-issues";
import { v } from "./validation";

/** Parses `input` against `schema`, returning the validated output or throwing `Invalid environment: <path>: <message>; …`. @internal */
export function parseEnv<T>(schema: v.BaseSchema<unknown, T, v.BaseIssue<unknown>>, input: unknown): T {
  const result = v.safeParse(schema, input);
  if (!result.success) {
    throw new Error(`Invalid environment: ${formatValidationIssues(result.issues)}`);
  }
  return result.output;
}
