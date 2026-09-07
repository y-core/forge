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
