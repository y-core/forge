import type { SqlFragment } from "./types";

/** Placeholder used in generated SQL text. @public */
export const SQL_PLACEHOLDER = "?";

/**
 * Tagged template that builds a SqlFragment.
 * Every interpolated value becomes a `?` bind param.
 * Nested SqlFragment values are flattened — text merged, params concatenated. @public
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment {
  let text = strings[0] ?? "";
  const params: unknown[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const next = strings[i + 1] ?? "";
    if (isSqlFragment(value)) {
      text += value.text + next;
      params.push(...value.params);
    } else {
      text += SQL_PLACEHOLDER + next;
      params.push(value);
    }
  }
  return { text, params };
}

/** Type guard for SqlFragment. @public */
export function isSqlFragment(x: unknown): x is SqlFragment {
  return (
    typeof x === "object" &&
    x !== null &&
    "text" in x &&
    "params" in x &&
    typeof (x as SqlFragment).text === "string" &&
    Array.isArray((x as SqlFragment).params)
  );
}
