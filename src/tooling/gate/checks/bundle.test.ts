import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { BUNDLE_FIXER, BUNDLES } from "../../../../config/bundles";
import { checkBundle, checkNodeExports, hasEsbuild, nodeBundles } from "./bundle";
import type { BundleCheckConfig, ExportsMap, NodeManifest } from "./types";

const ROOT = resolve(import.meta.dir, "../../../..");

const PACKAGE = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8")) as Record<
  "dependencies" | "peerDependencies",
  Record<string, string>
> &
  Required<NodeManifest>;
const DECLARED = { ...PACKAGE.dependencies, ...PACKAGE.peerDependencies };
const CONFIGS: readonly BundleCheckConfig[] = BUNDLES.map(({ entry, bundle }) => ({ root: ROOT, entry, bundle, fixer: BUNDLE_FIXER }));
const PLUGIN_BUNDLE = "src/tooling/lint/plugin.mjs";
const WRANGLER_BUNDLE = "src/tooling/cf/wrangler.mjs";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// The whole point of committing a bundle is that node loads it where it refuses the source, so the
// properties that make that true are asserted on the committed files themselves.
describe("the committed bundles", () => {
  it("resolves nothing at all at load time, so a consumer's `node_modules` layout cannot break the plugin", () => {
    const source = readFileSync(resolve(ROOT, PLUGIN_BUNDLE), "utf-8");

    expect(source.match(/^\s*(?:import|require)\b/m)).toBeNull();
  });

  it("keeps a package dependency as an import rather than inlining it", () => {
    const source = readFileSync(resolve(ROOT, WRANGLER_BUNDLE), "utf-8");

    expect([...source.matchAll(/^\s*import\b[^\n]*?["']([^"']+)["']/gm)].map((match) => match[1])).toContain("valibot");
  });

  for (const { bundle } of BUNDLES) {
    it(`imports only node builtins and declared dependencies or peers in ${bundle}`, () => {
      const source = readFileSync(resolve(ROOT, bundle), "utf-8");
      const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^\n]*?["']([^"']+)["']/gm)].map((match) => match[1] ?? "");
      const undeclared = specifiers.filter((specifier) => !specifier.startsWith("node:") && !Object.hasOwn(DECLARED, specifier));

      expect(undeclared).toEqual([]);
    });
  }

  it("default-exports the plugin oxlint reads, under the `forge` prefix its rule ids carry", async () => {
    const loaded = (await import(resolve(ROOT, PLUGIN_BUNDLE))) as { default: { meta: { name: string } } };

    expect(loaded.default.meta.name).toBe("forge");
  });
});

const NODE_PAIR = { types: "./src/a.ts", import: "./src/a.mjs" };

const nodeMessages = (exports: ExportsMap, node: readonly string[]) =>
  checkNodeExports({ exports, node, fixer: BUNDLE_FIXER }).findings.map((finding) => finding.message);

describe("checkNodeExports()", () => {
  it("passes this repository's export map against its `forge.node` declaration", () => {
    const result = checkNodeExports({ exports: PACKAGE.exports, node: PACKAGE.forge.node ?? [], fixer: BUNDLE_FIXER });

    expect(result.findings).toEqual([]);
  });

  it("fails a listed subpath the export map does not carry", () => {
    expect(nodeMessages({}, ["./a"])).toEqual(["`./a` is listed under `forge.node` but is not an export"]);
  });

  it("fails a listed subpath whose `import` is still the `.ts` source, naming the regeneration verb", () => {
    const result = checkNodeExports({ exports: { "./a": { types: "./src/a.ts", import: "./src/a.ts" } }, node: ["./a"], fixer: BUNDLE_FIXER });

    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`./a` is imported by Node but its export does not point `import` at a generated `.mjs`",
    ]);
    expect(result.findings[0]?.detail?.at(-1)).toContain(`run \`${BUNDLE_FIXER}\``);
  });

  it("names the missing `types` condition, not the `import` target, when a listed `.mjs` export has no `.ts` entry", () => {
    const expected = ["`./a` points `import` at a `.mjs` but has no `.ts` `types` condition to build it from"];

    expect(nodeMessages({ "./a": "./src/a.mjs" }, ["./a"])).toEqual(expected);
    expect(nodeMessages({ "./a": { import: "./src/a.mjs" } }, ["./a"])).toEqual(expected);
  });

  it("fails an `.mjs` export the declaration leaves out, string form or conditional", () => {
    expect(nodeMessages({ "./a": NODE_PAIR, "./b": "./src/b.mjs" }, [])).toEqual([
      "`./a` exports a `.mjs` bundle but is not listed under `forge.node`",
      "`./b` exports a `.mjs` bundle but is not listed under `forge.node`",
    ]);
  });

  it("leaves an unlisted `.ts` export alone, since nothing infers which exports Node reaches", () => {
    expect(nodeMessages({ "./a": { types: "./src/a.ts", import: "./src/a.ts" } }, [])).toEqual([]);
  });
});

describe("nodeBundles()", () => {
  it("derives this repository's rows from `forge.node`, entry from `types` and bundle from `import`", () => {
    expect(nodeBundles(ROOT, PACKAGE).find(({ label }) => label === "validate-testing-totp-bundle")).toMatchObject({
      entry: "src/testing/totp.ts",
      bundle: "src/testing/totp.mjs",
    });
  });

  it("watches a module the entry reaches only transitively", () => {
    const totp = nodeBundles(ROOT, PACKAGE).find(({ label }) => label === "validate-testing-totp-bundle");

    expect(totp?.watches).toContain("src/crypto/primitives/hotp.ts");
  });

  it("derives a row for a newly listed export with no other edit, and none for an export Node cannot load", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "forge-node-bundles-"));
    roots.push(dir);
    mkdirSync(resolve(dir, "src/scratch"), { recursive: true });
    writeFileSync(resolve(dir, "src/scratch/entry.ts"), 'export { helper } from "./helper";\n', "utf-8");
    writeFileSync(resolve(dir, "src/scratch/helper.ts"), "export const helper = 1;\n", "utf-8");
    writeFileSync(resolve(dir, "src/scratch/unrelated.ts"), "export const unrelated = 1;\n", "utf-8");

    const rows = nodeBundles(dir, {
      exports: {
        "./scratch/entry": { types: "./src/scratch/entry.ts", import: "./src/scratch/entry.mjs" },
        "./scratch/source": { types: "./src/scratch/helper.ts", import: "./src/scratch/helper.ts" },
      },
      forge: { node: ["./scratch/entry", "./scratch/source"] },
    });

    expect(rows).toEqual([
      {
        label: "validate-scratch-entry-bundle",
        entry: "src/scratch/entry.ts",
        bundle: "src/scratch/entry.mjs",
        watches: ["src/scratch/entry.ts", "src/scratch/helper.ts", "src/scratch/entry.mjs"],
      },
    ]);
  });

  it("derives nothing from a manifest with no `forge.node` declaration", () => {
    expect(nodeBundles(ROOT, { exports: PACKAGE.exports })).toEqual([]);
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
      roots.push(dir);
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
