import { describe, expect, it } from "bun:test";

import { CliError } from "../../cli/errors";
import { fakeDbIo } from "../db.fixture";
import { sha256 } from "../digest";
import { formatComposeHeader, formatCustomHeader, parseMigrationHeader } from "../schema/header";
import { discoverMigrations, migrationChecksum, migrationFileName, migrationsDigest, nextMigrationNumber, readMigrationFiles } from "./files";

const ADD_INDEX = { name: "0002_add_index.sql", path: "/m/0002_add_index.sql", sql: "CREATE INDEX i ON t (a);" };
const INIT = { name: "0001_init.sql", path: "/m/0001_init.sql", sql: "CREATE TABLE t (a);" };
const EDITED_INIT = { ...INIT, sql: "CREATE TABLE t (b);" };
const files = [ADD_INDEX, INIT];

describe("readMigrationFiles()", () => {
  it("reads only <NNNN>_<name>.sql files and treats an absent directory as empty", () => {
    const io = fakeDbIo({ "/m/0002_b.sql": "B", "/m/0001_a.sql": "A", "/m/README.md": "x", "/m/notes.sql": "n" });
    expect(discoverMigrations(readMigrationFiles(io, "/m")).map((m) => m.name)).toEqual(["0001_a", "0002_b"]);
    expect(readMigrationFiles(io, "/absent")).toEqual([]);
  });
});

describe("discoverMigrations()", () => {
  it("orders by number, numbers by the prefix, and hashes the body", () => {
    const found = discoverMigrations(files);
    expect(found.map((m) => [m.name, m.version])).toEqual([
      ["0001_init", 1],
      ["0002_add_index", 2],
    ]);
    expect(found[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("orders numerically as wrangler does, so a five-digit number follows a four-digit one and a one-digit number leads", () => {
    const named = (name: string) => ({ name: `${name}.sql`, path: `/m/${name}.sql`, sql: "" });
    const found = discoverMigrations([named("9999_small"), named("10000_big"), named("0002_next"), named("1_init")]);
    expect(found.map((m) => m.name)).toEqual(["1_init", "0002_next", "9999_small", "10000_big"]);
  });

  it("refuses two files sharing a number, naming both", () => {
    expect(() => discoverMigrations([...files, { name: "0002_other.sql", path: "/m/0002_other.sql", sql: "" }])).toThrow(
      "0002_other.sql and 0002_add_index.sql share the number 0002 — renumber one so they apply in one order",
    );
  });

  it("refuses a name wrangler would not apply", () => {
    expect(() => discoverMigrations([{ name: "init.sql", path: "/m/init.sql", sql: "" }])).toThrow(
      "init.sql is not a migration file name — wrangler applies <NNNN>_<name>.sql and nothing else",
    );
    expect(() => discoverMigrations([{ name: "init.sql", path: "/m/init.sql", sql: "" }])).toThrow(CliError);
  });
});

describe("discoverMigrations() origins", () => {
  const body = "CREATE TABLE t (a);";

  it("reads a compose header as a generated migration, with the stamp it carries", () => {
    const desired = { "config/schema.sql": "d1" };
    const sql = `${formatComposeHeader({ desired, baseline: "b1", forge: "0.1.10" }, body)}${body}`;
    const found = discoverMigrations([{ name: "0001_init.sql", path: "/m/0001_init.sql", sql }]);
    expect(found[0]?.origin).toBe("generated");
    expect(found[0]?.stamp).toEqual({ desired, baseline: "b1", body: sha256(parseMigrationHeader(sql).covered), forge: "0.1.10" });
  });

  it("reads a custom header as a hand-written migration, which carries no stamp", () => {
    const found = discoverMigrations([{ name: "0001_init.sql", path: "/m/0001_init.sql", sql: `${formatCustomHeader()}${body}` }]);
    expect(found[0]?.origin).toBe("custom");
    expect(found[0]?.stamp).toBe(null);
  });

  it("reads a file with neither header as custom", () => {
    const found = discoverMigrations([{ name: "0001_init.sql", path: "/m/0001_init.sql", sql: `-- a note\n${body}` }]);
    expect(found[0]?.origin).toBe("custom");
    expect(found[0]?.stamp).toBe(null);
  });
});

describe("nextMigrationNumber()", () => {
  it("is above every version on disk, and 1 when there is none", () => {
    expect(nextMigrationNumber(discoverMigrations(files))).toBe(3);
    expect(nextMigrationNumber([])).toBe(1);
  });
});

describe("migrationsDigest()", () => {
  it("is stable across calls and moves when one byte of one file moves", () => {
    const a = migrationsDigest(discoverMigrations(files));
    expect(a).toBe(migrationsDigest(discoverMigrations(files)));
    expect(a).not.toBe(migrationsDigest(discoverMigrations([ADD_INDEX, EDITED_INIT])));
  });
});

describe("migrationChecksum() — the stamp is not part of a migration's identity", () => {
  const body = "CREATE TABLE t (a);";
  const stamped = (baseline: string, text = body) =>
    `${formatComposeHeader({ desired: { "schema.sql": "d1" }, baseline, forge: "0.1.10" }, text)}${text}`;
  const one = { name: "0002_schema.sql", path: "/m/0002_schema.sql", sql: stamped("history-a") };
  const restamped = { ...one, sql: stamped("history-b") };
  const edited = { ...one, sql: stamped("history-a", "CREATE TABLE t (b);") };

  it("gives two files differing only in their stamp JSON the same checksum and the same migrations digest", () => {
    expect(one.sql).not.toBe(restamped.sql);
    expect(migrationChecksum(one.sql)).toBe(migrationChecksum(restamped.sql));
    expect(discoverMigrations([INIT, one])[1]?.sha256).toBe(migrationChecksum(one.sql));
    expect(migrationsDigest(discoverMigrations([INIT, one]))).toBe(migrationsDigest(discoverMigrations([INIT, restamped])));
  });

  it("moves both when the body under the stamp is edited", () => {
    expect(migrationChecksum(edited.sql)).not.toBe(migrationChecksum(one.sql));
    expect(migrationsDigest(discoverMigrations([INIT, edited]))).not.toBe(migrationsDigest(discoverMigrations([INIT, one])));
  });

  it("is the whole file's hash for a custom migration, which carries no stamp to blank", () => {
    expect(migrationChecksum(INIT.sql)).toBe(sha256(INIT.sql));
  });
});

describe("migrationFileName()", () => {
  it("pads the number to four digits and leaves a longer one alone", () => {
    expect(migrationFileName(4, "add_notes")).toBe("0004_add_notes.sql");
    expect(migrationFileName(12345, "add_notes")).toBe("12345_add_notes.sql");
  });

  it("reduces the name to what a file name and wrangler both accept", () => {
    expect(migrationFileName(1, "add notes!")).toBe("0001_add_notes_.sql");
    expect(migrationFileName(1, "keep-it_2")).toBe("0001_keep-it_2.sql");
  });
});
