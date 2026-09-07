import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gateIndexPath, indexPath, openDatabase, readMeta, stampVersions, versionsMatch, writeMeta } from "./db";

describe("indexPath() and gateIndexPath()", () => {
  it("put both under `.forge/`, which is already a gitignored build artifact", () => {
    expect(indexPath("/repo")).toBe(join("/repo", ".forge", "warden", "index.sqlite"));
    expect(gateIndexPath("/repo")).toBe(join("/repo", ".forge", "warden", "gate.sqlite"));
  });

  it("keeps them separate, so a developer's working index can never change a verdict", () => {
    expect(indexPath("/repo")).not.toBe(gateIndexPath("/repo"));
  });
});

describe("openDatabase()", () => {
  it("creates the schema on a new file and leaves an existing one alone", () => {
    const path = join(mkdtempSync(join(tmpdir(), "warden-db-")), "nested", "index.sqlite");

    const first = openDatabase(path);
    writeMeta(first, "probe", "kept");
    first.close();

    expect(existsSync(path)).toBe(true);

    const second = openDatabase(path);
    expect(readMeta(second, "probe")).toBe("kept");
    second.close();
  });

  it("replaces the tables when the stored schema version is not this one", () => {
    const path = join(mkdtempSync(join(tmpdir(), "warden-db-schema-")), "index.sqlite");

    const first = openDatabase(path);
    writeMeta(first, "schema_version", "0");
    writeMeta(first, "probe", "dropped with the rest");
    first.run("ALTER TABLE chunk DROP COLUMN searchable");
    first.close();

    // A rebuild empties and refills; only this can change a column, so without it an index written
    // by an older schema keeps its shape and fails the first insert naming a new one.
    const second = openDatabase(path);

    expect(() => second.query("SELECT searchable FROM chunk").all()).not.toThrow();
    expect(readMeta(second, "probe")).toBeUndefined();
    second.close();
  });

  it("removes a column the current schema has dropped, not only restores one it added", () => {
    const path = join(mkdtempSync(join(tmpdir(), "warden-db-dropped-")), "index.sqlite");

    const first = openDatabase(path);
    writeMeta(first, "schema_version", "0");
    first.run("ALTER TABLE chunk ADD COLUMN search_body TEXT NOT NULL DEFAULT ''");
    first.close();

    // A leftover `NOT NULL` column an insert no longer names is the failure this guards: the old
    // shape has to go, not be widened around.
    const second = openDatabase(path);

    expect(() => second.query("SELECT search_body FROM chunk").all()).toThrow();
    second.close();
  });
});

describe("meta", () => {
  it("overwrites a key rather than duplicating it", () => {
    const db = openDatabase(":memory:");
    writeMeta(db, "k", "one");
    writeMeta(db, "k", "two");

    expect(readMeta(db, "k")).toBe("two");
    db.close();
  });

  it("returns undefined for a key never written", () => {
    const db = openDatabase(":memory:");

    expect(readMeta(db, "absent")).toBeUndefined();
    db.close();
  });
});

describe("versionsMatch()", () => {
  it("is false before stamping, true after, and false again for a different canon", () => {
    const db = openDatabase(":memory:");

    expect(versionsMatch(db, "1.0.0")).toBe(false);
    stampVersions(db, "1.0.0");
    expect(versionsMatch(db, "1.0.0")).toBe(true);
    expect(versionsMatch(db, "1.0.1")).toBe(false);
    db.close();
  });
});
