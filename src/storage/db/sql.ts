/**
 * A parameterised SQL fragment — values are bind params, never concatenated text.
 * Compose fragments with nested interpolation; they flatten automatically. @public
 */
export interface SqlFragment {
  readonly text: string;
  readonly params: readonly unknown[];
}

/** Placeholder used in generated SQL text. @public */
export const SQL_PLACEHOLDER = "?";

/**
 * Tagged template that builds a SqlFragment.
 * Every interpolated value becomes a `?` bind param.
 * Nested SqlFragment values are flattened — text merged, params concatenated. @public
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment {
  let text = strings[0];
  const params: unknown[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (isSqlFragment(value)) {
      text += value.text + strings[i + 1];
      params.push(...value.params);
    } else {
      text += SQL_PLACEHOLDER + strings[i + 1];
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
