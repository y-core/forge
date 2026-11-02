import { quoteSqlIdentifier, quoteSqlLiteral } from "./sql";

/** A value this module refuses to write as SQL, naming the column so the message points at the schema. @internal */
export class UnsupportedValue extends Error {
  readonly column: string;
  readonly reason: string;

  constructor(column: string, reason: string) {
    super(`${column}: ${reason}`);
    this.name = "UnsupportedValue";
    this.column = column;
    this.reason = reason;
  }
}

/** A REAL that a JavaScript number cannot tell from an integer, because an integral value reads back without its fraction; the class is what keeps it from restoring as INTEGER. @internal */
export class SqlReal {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }
}

function toBlobBytes(value: unknown): readonly number[] | null {
  if (value instanceof Uint8Array) return [...value];
  if (!Array.isArray(value)) return null;
  const bytes = value as readonly unknown[];
  return bytes.every((byte) => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255) ? (bytes as number[]) : null;
}

function toBlobHex(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A value as SQL text, carrying a newline on a token rather than on an escape D1's dumper leaves ambiguous. @internal */
export function sqlValueExpression(column: string, value: unknown): string {
  if (value === null) return "NULL";
  if (value instanceof SqlReal) {
    if (!Number.isFinite(value.value)) throw new UnsupportedValue(column, `${String(value.value)} has no SQL literal`);
    const text = String(value.value);
    return /^-?\d+$/.test(text) ? `${text}.0` : text;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new UnsupportedValue(column, `${String(value)} has no SQL literal`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new UnsupportedValue(column, `the integer ${value} is past 2^53 and cannot round-trip`);
    }
    return String(value);
  }
  if (typeof value !== "string") {
    const bytes = toBlobBytes(value);
    if (bytes !== null) return `X'${toBlobHex(bytes)}'`;
    throw new UnsupportedValue(
      column,
      `a ${typeof value} cannot be written as SQL — a BLOB is a Uint8Array or an array of byte values, and this is not one`,
    );
  }
  if (value === "") return "''";
  const literal = (text: string): string => {
    try {
      return quoteSqlLiteral(text);
    } catch (error) {
      throw new UnsupportedValue(column, error instanceof Error ? error.message : String(error));
    }
  };
  if (!value.includes("\n") && !value.includes("\r")) return literal(value);

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const suffix = attempt === 0 ? "" : String(attempt);
    const lineFeed = `~~N${suffix}~~`;
    const carriageReturn = `~~R${suffix}~~`;
    const encoded: string = value.replaceAll("\r", carriageReturn).replaceAll("\n", lineFeed);
    if (encoded.replaceAll(lineFeed, "\n").replaceAll(carriageReturn, "\r") !== value) continue;
    let expression: string = literal(encoded);
    if (value.includes("\n")) expression = `replace(${expression},${quoteSqlLiteral(lineFeed)},char(10))`;
    if (value.includes("\r")) expression = `replace(${expression},${quoteSqlLiteral(carriageReturn)},char(13))`;
    return expression;
  }
  throw new UnsupportedValue(column, "no newline token survives a round trip against this value — every candidate occurs in the data");
}

/** One row as a single-line `INSERT` naming its columns, so it loads into a schema whose column order differs; `orIgnore` writes the idempotent form a seed needs. @internal */
export function insertStatement(
  table: string,
  columns: readonly string[],
  row: Readonly<Record<string, unknown>>,
  options?: { readonly orIgnore?: boolean },
): string {
  const names = columns.map(quoteSqlIdentifier).join(",");
  const values = columns
    .map((column) => {
      if (!Object.hasOwn(row, column)) throw new UnsupportedValue(column, "the column is absent from the row — the read did not return it");
      return sqlValueExpression(column, row[column]);
    })
    .join(",");
  const verb = options?.orIgnore === true ? "INSERT OR IGNORE INTO" : "INSERT INTO";
  return `${verb} ${quoteSqlIdentifier(table)} (${names}) VALUES (${values});`;
}
