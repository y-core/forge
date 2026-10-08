import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { BUNDLE_FIXER, BUNDLES } from "../../../../config/bundles";
import { checkBundle, hasEsbuild } from "./bundle";
import type { BundleCheckConfig } from "./types";

const ROOT = resolve(import.meta.dir, "../../../..");

const DEPENDENCIES = (JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8")) as { dependencies: Record<string, string> }).dependencies;
const CONFIGS: readonly BundleCheckConfig[] = BUNDLES.map(({ entry, bundle }) => ({ root: ROOT, entry, bundle, fixer: BUNDLE_FIXER }));
const PLUGIN_BUNDLE = "src/tooling/lint/plugin.mjs";
const CHROMIUM_BUNDLE = "src/tooling/gate/chromium.mjs";
const WRANGLER_BUNDLE = "src/tooling/cf/wrangler.mjs";

// The whole point of committing a bundle is that node loads it where it refuses the source, so the
// properties that make that true are asserted on the committed files themselves.
describe("the committed bundles", () => {
  it("resolves nothing at all at load time, so a consumer's `node_modules` layout cannot break the plugin", () => {
    const source = readFileSync(resolve(ROOT, PLUGIN_BUNDLE), "utf-8");

    expect(source.match(/^\s*(?:import|require)\b/m)).toBeNull();
  });

  it("resolves only node builtins, so a consumer's `node_modules` layout cannot break the chromium bundle", () => {
    const source = readFileSync(resolve(ROOT, CHROMIUM_BUNDLE), "utf-8");

    expect([...source.matchAll(/^\s*(?:import|require)\b[^\n]*?["']([^"']+)["']/gm)].map((match) => match[1])).toEqual(["node:fs"]);
  });

  it("keeps a package dependency as an import rather than inlining it", () => {
    const source = readFileSync(resolve(ROOT, WRANGLER_BUNDLE), "utf-8");

    expect([...source.matchAll(/^\s*import\b[^\n]*?["']([^"']+)["']/gm)].map((match) => match[1])).toContain("valibot");
  });

  for (const { bundle } of BUNDLES) {
    it(`imports only node builtins and declared dependencies in ${bundle}`, () => {
      const source = readFileSync(resolve(ROOT, bundle), "utf-8");
      const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^\n]*?["']([^"']+)["']/gm)].map((match) => match[1] ?? "");
      const undeclared = specifiers.filter((specifier) => !specifier.startsWith("node:") && !Object.hasOwn(DEPENDENCIES, specifier));

      expect(undeclared).toEqual([]);
    });
  }

  it("default-exports the plugin oxlint reads, under the `forge` prefix its rule ids carry", async () => {
    const loaded = (await import(resolve(ROOT, PLUGIN_BUNDLE))) as { default: { meta: { name: string } } };

    expect(loaded.default.meta.name).toBe("forge");
  });

  it("exports the resolution a `playwright.config.ts` imports, callable under node", async () => {
    const loaded = (await import(resolve(ROOT, CHROMIUM_BUNDLE))) as { resolveChromiumPath: () => string | undefined };

    expect(typeof loaded.resolveChromiumPath).toBe("function");
  });
});

describe("checkBundle()", () => {
  it("finds the optional peer this repository installs", () => {
    expect(hasEsbuild()).toBe(true);
  });

  for (const config of CONFIGS) {
    it.skipIf(!hasEsbuild())(`passes against the committed ${config.bundle}`, async () => {
      const result = await checkBundle(config);

      expect(result.findings).toEqual([]);
    });

    it.skipIf(!hasEsbuild())(`fails with a regeneration hint when ${config.bundle} is missing`, async () => {
      const result = await checkBundle({ ...config, bundle: "src/tooling/gate/absent.mjs" });

      expect(result.findings.map((finding) => finding.message)).toEqual(["the committed bundle is missing"]);
      expect(result.findings[0]?.detail).toEqual([`run \`${config.fixer}\``]);
    });

    it.skipIf(!hasEsbuild())(`fails when ${config.bundle} has been hand-edited`, async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "forge-bundle-"));
      const committed = readFileSync(resolve(ROOT, config.bundle), "utf-8");
      writeFileSync(resolve(dir, "edited.mjs"), `${committed}\n// hand edit\n`, "utf-8");

      const result = await checkBundle({ ...config, bundle: resolve(dir, "edited.mjs") });

      expect(result.ok).toBe(false);
      expect(result.findings.map((finding) => finding.message)).toEqual(["the committed bundle no longer matches its source"]);
    });
  }

  it.skipIf(!hasEsbuild())("names the caller's own regeneration verb rather than a forge script", async () => {
    const result = await checkBundle({ root: ROOT, entry: "src/tooling/lint/mod.ts", bundle: "src/tooling/gate/absent.mjs", fixer: "pnpm gen" });

    expect(result.findings[0]?.detail).toEqual(["run `pnpm gen`"]);
  });
});
