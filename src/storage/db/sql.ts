import type { SqlFragment } from "./types";

/** Placeholder used in generated SQL text. @public */
export const SQL_PLACEHOLDER = "?";

/**
 * Provenance brand stamped on every fragment {@link sql} mints.
 *
 * Deliberately **not** re-exported from `mod.ts`: a consumer who cannot name this symbol cannot
 * mint a value that satisfies {@link isSqlFragment}, which turns that guard from a *shape* check
 * into a *provenance* check. This is what closes the injection path — `JSON.parse` output can
 * never carry a symbol key, so attacker-controlled JSON shaped `{text, params}` is now bound as
 * a parameter instead of being concatenated into the statement text.
 *
 * @internal
 */
export const SQL_FRAGMENT_BRAND: unique symbol = Symbol("forge.storage.db.SqlFragment");

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
  return { [SQL_FRAGMENT_BRAND]: true, text, params };
}

/**
 * Type guard for SqlFragment — a **provenance** check, not a shape check.
 *
 * Only {@link sql} can produce a value that passes, because only this module can name
 * {@link SQL_FRAGMENT_BRAND}. A structurally identical `{text, params}` object — notably anything
 * `JSON.parse` returns — is rejected, so `sql` binds it as a parameter rather than splicing its
 * `text` into the statement. @public
 */
export function isSqlFragment(x: unknown): x is SqlFragment {
  return typeof x === "object" && x !== null && (x as Partial<SqlFragment>)[SQL_FRAGMENT_BRAND] === true;
}
