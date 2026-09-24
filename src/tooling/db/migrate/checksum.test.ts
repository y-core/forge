import { describe, expect, it } from "bun:test";

import type { Migration, RecordedChecksum } from "../types";
import {
  certifiedFingerprint,
  certifyFingerprintSql,
  compareChecksums,
  RECORDED_CHECKSUM_SELECT,
  recordMigrationSql,
  toRecordedChecksums,
} from "./checksum";

function migration(name: string, sha256: string): Migration {
  const version = Number(name.slice(0, 4));
  return { name, version, path: `/m/${name}.sql`, sha256, sql: "", origin: "custom", stamp: null };
}

function recorded(appliedName: string, sha256: string, fingerprint: string | null = null): RecordedChecksum {
  return { appliedName, sha256, appliedAt: 0, fingerprint };
}

describe("RECORDED_CHECKSUM_SELECT", () => {
  it("selects the four columns from _forge_migrations in insertion order", () => {
    expect(RECORDED_CHECKSUM_SELECT).toBe("SELECT name, sha256, applied_at, fingerprint FROM _forge_migrations ORDER BY id");
  });
});

describe("recordMigrationSql()", () => {
  it("inserts the name, the hash and the applied time as a plain INSERT", () => {
    expect(recordMigrationSql(migration("0001_init", "aa"), 1_700_000_000_000)).toBe(
      "INSERT INTO _forge_migrations (name, sha256, applied_at) VALUES ('0001_init', 'aa', 1700000000000);",
    );
  });

  it("quotes a name that carries a single quote", () => {
    expect(recordMigrationSql(migration("0001_it's", "aa"), 0)).toBe(
      "INSERT INTO _forge_migrations (name, sha256, applied_at) VALUES ('0001_it''s', 'aa', 0);",
    );
  });
});

describe("certifyFingerprintSql()", () => {
  it("updates the fingerprint on the most recently inserted row", () => {
    expect(certifyFingerprintSql("ff")).toBe(
      "UPDATE _forge_migrations SET fingerprint = 'ff' WHERE id = (SELECT id FROM _forge_migrations ORDER BY id DESC LIMIT 1);",
    );
  });
});

describe("toRecordedChecksums()", () => {
  it("reads name, hash, applied time and fingerprint out of a row", () => {
    expect(toRecordedChecksums([{ name: "0001_init", sha256: "aa", applied_at: 5, fingerprint: "ff" }])).toEqual([
      { appliedName: "0001_init", sha256: "aa", appliedAt: 5, fingerprint: "ff" },
    ]);
  });

  it("reads a NULL fingerprint as null rather than the string 'null'", () => {
    expect(toRecordedChecksums([{ name: "0001_init", sha256: "aa", applied_at: 5, fingerprint: null }])[0]?.fingerprint).toBeNull();
  });

  it("defaults every missing column for a malformed row", () => {
    expect(toRecordedChecksums([{}])).toEqual([{ appliedName: "", sha256: "", appliedAt: 0, fingerprint: null }]);
  });

  it("is empty for no rows", () => {
    expect(toRecordedChecksums([])).toEqual([]);
  });
});

describe("certifiedFingerprint()", () => {
  it("skips the uncertified rows a part-applied batch left and returns the newest certified one", () => {
    expect(certifiedFingerprint([recorded("0001_init", "a", "fp1"), recorded("0002_add", "b"), recorded("0003_add", "c")])).toBe("fp1");
  });

  it("prefers the newest of several certified rows", () => {
    expect(certifiedFingerprint([recorded("0001_init", "a", "fp1"), recorded("0002_add", "b", "fp2")])).toBe("fp2");
  });

  it("is null when no row ever certified one, and when there are no rows", () => {
    expect(certifiedFingerprint([recorded("0001_init", "a")])).toBe(null);
    expect(certifiedFingerprint([])).toBe(null);
  });
});

describe("compareChecksums()", () => {
  const discovered = [migration("0001_init", "aa"), migration("0002_next", "bb")];

  it("finds nothing wrong when every recorded hash matches the file on disk", () => {
    expect(compareChecksums([recorded("0001_init", "aa"), recorded("0002_next", "bb")], discovered)).toEqual([]);
  });

  it("reports a file edited since it was applied as mismatched", () => {
    expect(compareChecksums([recorded("0001_init", "was")], discovered)).toEqual(["0001_init"]);
  });

  it("does not call a recorded migration mismatched when its file is gone from disk", () => {
    expect(compareChecksums([recorded("0009_gone", "zz")], discovered)).toEqual([]);
  });
});
