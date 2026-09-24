import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { barrelComponents } from "../../testing/coverage/components";
import { rootIdentifiers } from "../../tooling/gate/checks/design-parse";
import * as chrome from "../chrome/mod";
import * as controls from "../controls/mod";
import * as core from "../core/mod";
import { CATALOG_MISSING } from "./catalog-missing.fixture";

const PUBLISHED = [...new Set(barrelComponents({ chrome, controls, core }).map((entry) => entry.component))].sort();

const catalog = readFileSync(resolve(import.meta.dir, "catalog.md"), "utf-8");

const CITED = new Set(
  catalog
    .split("\n")
    .filter((line) => line.startsWith("| "))
    .flatMap((line) => rootIdentifiers(line.split("|")[2] ?? "")),
);

const excused = new Set(CATALOG_MISSING.map((gap) => gap.key));

describe("catalog.md covers every published component", () => {
  it("reads a meaningful number of components off the barrels, so the sweep cannot pass vacuously", () => {
    expect(PUBLISHED.length).toBeGreaterThan(40);
  });

  it("finds a Job → component row naming each one", () => {
    expect(PUBLISHED.filter((name) => !CITED.has(name) && !excused.has(name))).toEqual([]);
  });

  it("requires every excuse to name the task that owes it", () => {
    expect(CATALOG_MISSING.filter((gap) => gap.owner.trim() === "").map((gap) => gap.key)).toEqual([]);
  });

  it("keeps CATALOG_MISSING free of stale and unknown excuses", () => {
    expect([...excused].filter((key) => CITED.has(key))).toEqual([]);
    expect([...excused].filter((key) => !PUBLISHED.includes(key))).toEqual([]);
  });
});
