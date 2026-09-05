import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { checkDesignScale, type DesignScaleCheckConfig } from "./design-scale";
import { hasTailwind } from "./design-system";

const ROOT = resolve(import.meta.dir, "../../../..");

const CONFIG: DesignScaleCheckConfig = { root: ROOT, stylesheet: "src/ui/assets/css/tailwind.css", table: "src/tooling/lint/data/design-scale.ts" };

// oxlint loads the plugin through Node's ESM resolver, so an import in the generated module would
// break every forge rule at once.
describe("the generated module's dependency-free property", () => {
  it("imports nothing", () => {
    const source = readFileSync(resolve(ROOT, CONFIG.table), "utf-8");

    expect(source.match(/^\s*import\b/m)).toBeNull();
  });
});

describe("checkDesignScale()", () => {
  it.skipIf(!hasTailwind())("passes against the committed module", async () => {
    const result = await checkDesignScale(CONFIG);

    expect(result.findings).toEqual([]);
  });

  it.skipIf(!hasTailwind())("fails with a regeneration hint when the module is missing", async () => {
    const result = await checkDesignScale({ ...CONFIG, table: "src/tooling/lint/data/absent.ts" });

    expect(result.findings.map((finding) => finding.message)).toEqual(["the generated design scale is missing"]);
  });

  it.skipIf(!hasTailwind())("fails when the committed module has been hand-edited", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "forge-design-scale-"));
    const committed = readFileSync(resolve(ROOT, CONFIG.table), "utf-8");
    writeFileSync(resolve(dir, "edited.ts"), committed.replace('SPACING_UNIT = "0.25rem"', 'SPACING_UNIT = "0.5rem"'), "utf-8");

    const result = await checkDesignScale({ ...CONFIG, table: resolve(dir, "edited.ts") });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["the committed design scale no longer matches the design system"]);
  });

  it.skipIf(!hasTailwind())("passes a whitespace-only edit, which the `format` step owns rather than this one", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "forge-design-scale-"));
    const committed = readFileSync(resolve(ROOT, CONFIG.table), "utf-8");
    writeFileSync(resolve(dir, "respaced.ts"), committed.replace("export const SPACING_UNIT", "\n\nexport const SPACING_UNIT"), "utf-8");

    const result = await checkDesignScale({ ...CONFIG, table: resolve(dir, "respaced.ts") });

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });
});
