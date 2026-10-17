import { describe, expect, it } from "bun:test";

import { inMigrationOrder, isMigrationFileName } from "./migrations";

describe("isMigrationFileName()", () => {
  it("accepts wrangler's <number>_<name>.sql and nothing else", () => {
    expect(["0001_init.sql", "10_more.sql", "init.sql", "0001_init.txt", "0001_.sql"].map(isMigrationFileName)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("inMigrationOrder()", () => {
  it("orders by number, not by name, and carries the number", () => {
    const ordered = inMigrationOrder([{ name: "10_c.sql" }, { name: "1_a.sql" }, { name: "2_b.sql" }]);
    expect(ordered.map((file) => [file.name, file.version])).toEqual([
      ["1_a.sql", 1],
      ["2_b.sql", 2],
      ["10_c.sql", 10],
    ]);
  });

  it("keeps every other field of each file", () => {
    expect(inMigrationOrder([{ name: "0001_a.sql", sql: "SELECT 1;" }])).toEqual([{ name: "0001_a.sql", sql: "SELECT 1;", version: 1 }]);
  });

  it("refuses a number used twice, naming both files", () => {
    expect(() => inMigrationOrder([{ name: "0002_other.sql" }, { name: "0002_add_index.sql" }])).toThrow(
      "0002_other.sql and 0002_add_index.sql share the number 0002 — renumber one so they apply in one order",
    );
  });

  it("refuses a name wrangler would not apply", () => {
    expect(() => inMigrationOrder([{ name: "init.sql" }])).toThrow("init.sql is not a migration file name");
  });
});
