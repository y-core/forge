import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { checkDesignScale, compareDesignScale } from "./design-scale";
import { renderDesignScale } from "./design-scale-parse";
import { hasTailwind } from "./design-system";
import type { DesignScale, DesignScaleCheckConfig } from "./types";

const ROOT = resolve(import.meta.dir, "../../../..");

const CONFIG: DesignScaleCheckConfig = { root: ROOT, stylesheet: "src/ui/assets/css/tailwind.css", table: "src/tooling/lint/data/design-scale.ts" };
const SCALE: DesignScale = { spacingUnit: "0.25rem", spacingRoots: ["p"], spacingSteps: ["1", "2"], colorRoots: ["bg"], colorTokens: ["red-500"] };

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function scratchDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "forge-design-scale-"));
  roots.push(dir);
  return dir;
}

function committedModule(edit: (rendered: string) => string): string {
  const path = resolve(scratchDir(), "design-scale.ts");
  writeFileSync(path, edit(renderDesignScale(SCALE)), "utf-8");
  return path;
}

// oxlint loads the plugin through Node's ESM resolver, so an import in the generated module would
// break every forge rule at once.
describe("the generated module's dependency-free property", () => {
  it("imports nothing", () => {
    const source = readFileSync(resolve(ROOT, CONFIG.table), "utf-8");

    expect(source.match(/^\s*import\b/m)).toBeNull();
  });
});

describe("checkDesignScale() and compareDesignScale()", () => {
  it.skipIf(!hasTailwind())("passes against the committed module", async () => {
    const result = await checkDesignScale(CONFIG);

    expect(result.findings).toEqual([]);
  });

  it("fails with a regeneration hint when the module is missing", () => {
    const result = compareDesignScale({ ...CONFIG, table: resolve(scratchDir(), "absent.ts") }, SCALE);

    expect(result.findings.map((finding) => finding.message)).toEqual(["the generated design scale is missing"]);
  });

  it("fails when the committed module has been hand-edited", () => {
    const table = committedModule((rendered) => rendered.replace('SPACING_UNIT = "0.25rem"', 'SPACING_UNIT = "0.5rem"'));

    const result = compareDesignScale({ ...CONFIG, table }, SCALE);

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["the committed design scale no longer matches the design system"]);
  });

  it("passes a whitespace-only edit, which the `format` step owns rather than this one", () => {
    const table = committedModule((rendered) => rendered.replace("export const SPACING_UNIT", "\n\nexport const SPACING_UNIT"));

    const result = compareDesignScale({ ...CONFIG, table }, SCALE);

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });
});
