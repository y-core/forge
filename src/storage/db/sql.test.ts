import { describe, expect, it } from "bun:test";
import { isSqlFragment, SQL_PLACEHOLDER, sql } from "./sql";

describe("sql tagged template — injection prevention", () => {
  it("puts interpolated values in params, never in text", () => {
    const id = "1; DROP TABLE users";
    const fragment = sql`SELECT * FROM users WHERE id = ${id}`;
    expect(fragment.text).toBe(`SELECT * FROM users WHERE id = ${SQL_PLACEHOLDER}`);
    expect(fragment.params).toEqual(["1; DROP TABLE users"]);
  });

  it("handles multiple interpolated values", () => {
    const name = "Alice";
    const age = 30;
    const f = sql`INSERT INTO users (name, age) VALUES (${name}, ${age})`;
    expect(f.text).toBe(`INSERT INTO users (name, age) VALUES (${SQL_PLACEHOLDER}, ${SQL_PLACEHOLDER})`);
    expect(f.params).toEqual(["Alice", 30]);
  });

  it("flattens nested SqlFragment — composed WHERE clauses stay parameterised", () => {
    const condition = sql`status = ${"active"}`;
    const outer = sql`SELECT * FROM t WHERE ${condition} AND age > ${18}`;
    expect(outer.text).toBe(`SELECT * FROM t WHERE status = ${SQL_PLACEHOLDER} AND age > ${SQL_PLACEHOLDER}`);
    expect(outer.params).toEqual(["active", 18]);
  });

  it("handles empty interpolation list", () => {
    const f = sql`SELECT 1`;
    expect(f.text).toBe("SELECT 1");
    expect(f.params).toHaveLength(0);
  });

  it("flattens nested fragment with multiple params", () => {
    const inner = sql`(a = ${1} OR b = ${2})`;
    const outer = sql`SELECT * FROM t WHERE ${inner}`;
    expect(outer.text).toBe(`SELECT * FROM t WHERE (a = ${SQL_PLACEHOLDER} OR b = ${SQL_PLACEHOLDER})`);
    expect(outer.params).toEqual([1, 2]);
  });
});

describe("isSqlFragment", () => {
  it("returns true for a SqlFragment", () => {
    expect(isSqlFragment(sql`SELECT 1`)).toBe(true);
  });

  it("returns false for plain strings", () => {
    expect(isSqlFragment("SELECT 1")).toBe(false);
  });

  it("returns false for null and primitives", () => {
    expect(isSqlFragment(null)).toBe(false);
    expect(isSqlFragment(42)).toBe(false);
  });
});
