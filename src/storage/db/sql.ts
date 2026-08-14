import type { SqlFragment } from "./types";

/** Placeholder used in generated SQL text. @public */
export const SQL_PLACEHOLDER = "?";

/** Provenance brand stamped on every fragment {@link sql} mints — never re-exported from `mod.ts`, so consumer data cannot forge a fragment. @internal */
export const SQL_FRAGMENT_BRAND: unique symbol = Symbol("forge.storage.db.SqlFragment");

/** Tagged template that builds a SqlFragment, binding every interpolated value as a `?` param and flattening nested fragments. @public */
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
  return { [SQL_FRAGMENT_BRAND]: true, text, params };
}

/** Type guard for SqlFragment — a provenance check, not a shape check, so a structurally identical `{text, params}` object is rejected and bound as a parameter. @public */
export function isSqlFragment(x: unknown): x is SqlFragment {
  return typeof x === "object" && x !== null && (x as Partial<SqlFragment>)[SQL_FRAGMENT_BRAND] === true;
}
