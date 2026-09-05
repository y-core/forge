import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { rootIdentifiers } from "../../tooling/gate/checks/readme-exports-parse";
// oxlint-disable-next-line eslint/no-restricted-imports -- the published surface is what is being asserted
import * as chrome from "../chrome/mod";
// oxlint-disable-next-line eslint/no-restricted-imports -- the published surface is what is being asserted
import * as controls from "../controls/mod";
// oxlint-disable-next-line eslint/no-restricted-imports -- the published surface is what is being asserted
import * as core from "../core/mod";
import { CATALOG_MISSING } from "./catalog-missing";

function componentExports(barrel: Record<string, unknown>): string[] {
  return Object.entries(barrel)
    .filter(([name, value]) => /^[A-Z]/.test(name) && typeof value === "function")
    .map(([name]) => name);
}

const PUBLISHED = [...new Set([core, controls, chrome].flatMap((barrel) => componentExports(barrel as Record<string, unknown>)))].sort();

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
