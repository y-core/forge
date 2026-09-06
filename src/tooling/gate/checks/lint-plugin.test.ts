import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { checkLintPlugin, hasEsbuild, type LintPluginCheckConfig } from "./lint-plugin";

const ROOT = resolve(import.meta.dir, "../../../..");

const CONFIG: LintPluginCheckConfig = { root: ROOT, entry: "src/tooling/lint/mod.ts", bundle: "src/tooling/lint/plugin.mjs" };

// The whole point of committing the bundle is that node loads it where it refuses the source, so
// the properties that make that true are asserted on the committed file itself.
describe("the committed bundle", () => {
  it("resolves no module at load time, so a consumer's `node_modules` layout cannot break it", () => {
    const source = readFileSync(resolve(ROOT, CONFIG.bundle), "utf-8");

    expect(source.match(/^\s*(?:import|require)\b/m)).toBeNull();
  });

  it("default-exports the plugin oxlint reads, under the `forge` prefix its rule ids carry", async () => {
    const loaded = (await import(resolve(ROOT, CONFIG.bundle))) as { default: { meta: { name: string } } };

    expect(loaded.default.meta.name).toBe("forge");
  });
});

describe("checkLintPlugin()", () => {
  it("finds the optional peer this repository installs", () => {
    expect(hasEsbuild()).toBe(true);
  });

  it.skipIf(!hasEsbuild())("passes against the committed bundle", async () => {
    const result = await checkLintPlugin(CONFIG);

    expect(result.findings).toEqual([]);
  });

  it.skipIf(!hasEsbuild())("fails with a regeneration hint when the bundle is missing", async () => {
    const result = await checkLintPlugin({ ...CONFIG, bundle: "src/tooling/lint/absent.mjs" });

    expect(result.findings.map((finding) => finding.message)).toEqual(["the committed lint-plugin bundle is missing"]);
  });

  it.skipIf(!hasEsbuild())("fails when the committed bundle has been hand-edited", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "forge-lint-plugin-"));
    const committed = readFileSync(resolve(ROOT, CONFIG.bundle), "utf-8");
    writeFileSync(resolve(dir, "edited.mjs"), committed.replace('name: "forge"', 'name: "forged"'), "utf-8");

    const result = await checkLintPlugin({ ...CONFIG, bundle: resolve(dir, "edited.mjs") });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["the committed lint-plugin bundle no longer matches its source"]);
  });
});
