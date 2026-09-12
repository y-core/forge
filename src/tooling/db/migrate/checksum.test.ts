import { describe, expect, it } from "bun:test";

import type { Migration } from "../types";
import { appliedMigrationName, compareChecksums, recordChecksumSql, recordMetaSql, toRecordedChecksums } from "./checksum";

function migration(name: string, sha256: string): Migration {
  const version = Number(name.slice(0, 4));
  return { name, version, path: `/m/${name}.sql`, sha256, sql: "", origin: "custom", stamp: null };
}

describe("recordChecksumSql()", () => {
  it("writes one statement per migration, newline separated", () => {
    expect(recordChecksumSql([migration("0001_init", "aa"), migration("0002_next", "bb")])).toBe(
      [
        "INSERT OR REPLACE INTO forge_migrations (applied_name, sha256) VALUES ('0001_init', 'aa');",
        "INSERT OR REPLACE INTO forge_migrations (applied_name, sha256) VALUES ('0002_next', 'bb');",
      ].join("\n"),
    );
  });

  it("quotes a name that carries a single quote", () => {
    expect(recordChecksumSql([migration("0001_it's", "aa")])).toBe(
      "INSERT OR REPLACE INTO forge_migrations (applied_name, sha256) VALUES ('0001_it''s', 'aa');",
    );
  });

  it("is empty for no migrations", () => {
    expect(recordChecksumSql([])).toBe("");
  });
});

describe("recordMetaSql()", () => {
  it("records the digest and the fingerprint under their two keys", () => {
    expect(recordMetaSql({ migrationsDigest: "dd", schemaFingerprint: "ff" })).toBe(
      [
        "INSERT OR REPLACE INTO forge_schema_meta (key, value) VALUES ('migrations_digest', 'dd');",
        "INSERT OR REPLACE INTO forge_schema_meta (key, value) VALUES ('schema_fingerprint', 'ff');",
      ].join("\n"),
    );
  });
});

describe("toRecordedChecksums()", () => {
  it("reads the applied name and the hash out of the rows, which is the whole row", () => {
    expect(toRecordedChecksums([{ applied_name: "0001_init", sha256: "aa" }])).toEqual([{ appliedName: "0001_init", sha256: "aa" }]);
    expect(toRecordedChecksums([])).toEqual([]);
  });
});

describe("compareChecksums()", () => {
  const discovered = [migration("0001_init", "aa"), migration("0002_next", "bb")];

  it("finds nothing wrong when every applied migration is recorded with the hash on disk", () => {
    expect(
      compareChecksums(
        ["0001_init", "0002_next"],
        [
          { appliedName: "0001_init", sha256: "aa" },
          { appliedName: "0002_next", sha256: "bb" },
        ],
        discovered,
      ),
    ).toEqual({ mismatched: [], unrecorded: [], orphaned: [] });
  });

  it("reports a file edited since it was applied as mismatched", () => {
    expect(compareChecksums(["0001_init"], [{ appliedName: "0001_init", sha256: "was" }], discovered)).toEqual({
      mismatched: ["0001_init"],
      unrecorded: [],
      orphaned: [],
    });
  });

  it("reports an applied migration forge never recorded as unrecorded", () => {
    expect(compareChecksums(["0001_init", "0002_next"], [{ appliedName: "0001_init", sha256: "aa" }], discovered)).toEqual({
      mismatched: [],
      unrecorded: ["0002_next"],
      orphaned: [],
    });
  });

  it("reports a recorded migration the migrations table no longer has as orphaned", () => {
    expect(compareChecksums([], [{ appliedName: "0001_init", sha256: "aa" }], discovered)).toEqual({
      mismatched: [],
      unrecorded: [],
      orphaned: ["0001_init"],
    });
  });

  it("does not call a recorded migration mismatched when its file is gone from disk", () => {
    expect(compareChecksums(["0009_gone"], [{ appliedName: "0009_gone", sha256: "zz" }], discovered)).toEqual({
      mismatched: [],
      unrecorded: [],
      orphaned: [],
    });
  });
});

describe("compareChecksums() against the recorded rows", () => {
  it("joins the two records through the applied name, which is all the migrations table knows", () => {
    expect(compareChecksums(["0001_init"], [{ appliedName: "0001_init", sha256: "aa" }], [migration("0001_init", "aa")])).toEqual({
      mismatched: [],
      unrecorded: [],
      orphaned: [],
    });
  });
});

describe("appliedMigrationName()", () => {
  it("drops the .sql wrangler records and leaves a bare name alone", () => {
    expect(["0001_init.sql", "0001_init", null].map(appliedMigrationName)).toEqual(["0001_init", "0001_init", ""]);
  });
});
