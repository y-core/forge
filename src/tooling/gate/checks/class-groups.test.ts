import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { checkClassGroups, compareClassGroups, FORGE_STATE_RECIPES, writeClassGroups } from "./class-groups";
import { renderClassGroups } from "./class-groups-parse";
import { canonical, hasTailwind } from "./design-system";
import type { ClassGroupsCheckConfig, ClassGroupTable } from "./types";

const ROOT = resolve(import.meta.dir, "../../../..");
// `stateRecipes` included, because the committed table is the one `config/steps.ts` derives: without
// it this compares forge's table against a table forge never generates.
const CONFIG: ClassGroupsCheckConfig = {
  root: ROOT,
  stylesheet: "src/ui/assets/css/tailwind.css",
  table: "src/ui/core/utils/class-groups.ts",
  stateRecipes: FORGE_STATE_RECIPES,
};
const TABLE: ClassGroupTable = { statics: new Map([["block", "display"]]), roots: new Map(), overrides: new Map() };

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function scratchDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "forge-class-groups-"));
  roots.push(dir);
  return dir;
}

function committedModule(edit: (rendered: string) => string): string {
  const path = resolve(scratchDir(), "class-groups.ts");
  writeFileSync(path, edit(renderClassGroups(TABLE)), "utf-8");
  return path;
}

describe("hasTailwind", () => {
  it("finds the optional peer this repository installs", () => {
    expect(hasTailwind()).toBe(true);
  });
});

describe("checkClassGroups and compareClassGroups", () => {
  it("passes against the committed table", async () => {
    const result = await checkClassGroups(CONFIG);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("src/ui/core/utils/class-groups.ts matches the table `src/ui/assets/css/tailwind.css` compiles to");
  });

  it("fails when the committed table has been hand-edited", () => {
    const table = committedModule((rendered) => rendered.replace('["block", "display"]', '["block", "position"]'));

    const result = compareClassGroups({ ...CONFIG, table }, TABLE);
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["the committed conflict table no longer matches the design system"]);
  });

  it("passes a whitespace-only edit, which the `format` step owns rather than this one", () => {
    const table = committedModule((rendered) => rendered.replace("const STATIC_GROUPS", "\n\nconst STATIC_GROUPS"));

    const result = compareClassGroups({ ...CONFIG, table }, TABLE);
    expect(result.ok).toBe(true);
  });

  it("fails, rather than throwing, when the table is missing", () => {
    const result = compareClassGroups({ ...CONFIG, table: resolve(scratchDir(), "no-such-table.ts") }, TABLE);
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["the generated conflict table is missing"]);
  });
});

describe("writeClassGroups", () => {
  it("writes a module matching the committed table modulo formatting", async () => {
    const table = resolve(scratchDir(), "written.ts");

    await writeClassGroups({ ...CONFIG, table });
    expect(canonical(readFileSync(table, "utf-8"))).toBe(canonical(readFileSync(resolve(ROOT, CONFIG.table), "utf-8")));
  });
});
