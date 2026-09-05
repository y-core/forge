import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { checkClassGroups, type ClassGroupsCheckConfig, FORGE_STATE_RECIPES, writeClassGroups } from "./class-groups";
import { hasTailwind } from "./design-system";

const ROOT = resolve(import.meta.dir, "../../../..");
// `stateRecipes` included, because the committed table is the one `config/steps.ts` derives: without
// it this compares forge's table against a table forge never generates.
const CONFIG: ClassGroupsCheckConfig = {
  root: ROOT,
  stylesheet: "src/ui/assets/css/tailwind.css",
  table: "src/ui/core/utils/class-groups.ts",
  stateRecipes: FORGE_STATE_RECIPES,
};

describe("hasTailwind", () => {
  it("finds the optional peer this repository installs", () => {
    expect(hasTailwind()).toBe(true);
  });
});

describe("checkClassGroups", () => {
  it("passes against the committed table", async () => {
    const result = await checkClassGroups(CONFIG);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("src/ui/core/utils/class-groups.ts matches the table `src/ui/assets/css/tailwind.css` compiles to");
  });

  it("fails when the committed table has been hand-edited", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "forge-class-groups-"));
    const committed = readFileSync(resolve(ROOT, CONFIG.table), "utf-8");
    writeFileSync(resolve(dir, "edited.ts"), committed.replace('["block", "display"]', '["block", "position"]'), "utf-8");

    const result = await checkClassGroups({ ...CONFIG, table: resolve(dir, "edited.ts") });
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["the committed conflict table no longer matches the design system"]);
  });

  it("passes a whitespace-only edit, which the `format` step owns rather than this one", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "forge-class-groups-"));
    const committed = readFileSync(resolve(ROOT, CONFIG.table), "utf-8");
    writeFileSync(resolve(dir, "respaced.ts"), committed.replace("const GROUPS", "\n\nconst GROUPS"), "utf-8");

    const result = await checkClassGroups({ ...CONFIG, table: resolve(dir, "respaced.ts") });
    expect(result.ok).toBe(true);
  });

  it("fails, rather than throwing, when the table is missing", async () => {
    const result = await checkClassGroups({ ...CONFIG, table: "src/ui/core/utils/no-such-table.ts" });
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["the generated conflict table is missing"]);
  });
});

describe("writeClassGroups", () => {
  it("writes a module the check then accepts", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "forge-class-groups-"));
    const table = resolve(dir, "written.ts");

    await writeClassGroups({ ...CONFIG, table });
    expect((await checkClassGroups({ ...CONFIG, table })).ok).toBe(true);
  });

  it("writes the same content as the committed table, modulo the formatting `gen:class-groups` applies after it", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "forge-class-groups-"));
    const table = resolve(dir, "written.ts");
    const strip = (source: string): string => source.replace(/\s+/g, "").replace(/,([\]}])/g, "$1");

    await writeClassGroups({ ...CONFIG, table });
    expect(strip(readFileSync(table, "utf-8"))).toBe(strip(readFileSync(resolve(ROOT, CONFIG.table), "utf-8")));
  });
});
