import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { type CheckResult, checkResult, fail } from "../finding";
import { fileURLToPathish } from "./design-system";

/** What the lint-plugin check needs to know about the project. @public */
export interface LintPluginCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** The plugin's TypeScript entry, relative to `root`. */
  entry: string;
  /** The committed bundle oxlint loads, relative to `root`. */
  bundle: string;
}

/** Whether `esbuild` can be resolved — the bundle cannot be rebuilt without it, and it is an optional peer. @public */
export function hasEsbuild(): boolean {
  try {
    import.meta.resolve("esbuild");
    return true;
  } catch {
    return false;
  }
}

/** Bundles the plugin entry into the single self-contained ES module oxlint loads through node. @public */
export async function bundleLintPlugin(config: LintPluginCheckConfig): Promise<string> {
  const esbuild = (await import("esbuild")) as typeof import("esbuild");
  const result = await esbuild.build({
    entryPoints: [resolve(config.root, config.entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    // Node refuses to strip types under `node_modules`, so a consumer's oxlint can only load a
    // plain `.mjs`. The banner is what tells a reader of that file not to edit it.
    banner: { js: `// Generated from ${config.entry} by \`bun run gen:lint-plugin\` — do not edit.` },
  });
  return result.outputFiles[0]?.text ?? "";
}

/** Rebuilds the plugin bundle and reports any drift from the committed copy. @public */
export async function checkLintPlugin(config: LintPluginCheckConfig): Promise<CheckResult> {
  const expected = await bundleLintPlugin(config);
  const path = resolve(config.root, config.bundle);

  let actual: string;
  try {
    actual = readFileSync(path, "utf-8");
  } catch {
    return checkResult(
      [fail("the committed lint-plugin bundle is missing", { file: config.bundle, detail: ["run `bun run gen:lint-plugin`"] })],
      "",
    );
  }

  if (actual === expected) return checkResult([], `${config.bundle} matches a fresh bundle of ${config.entry}`);

  return checkResult(
    [
      fail("the committed lint-plugin bundle no longer matches its source", {
        file: config.bundle,
        detail: [
          `\`${config.entry}\` now bundles to something else — a rule edit, an \`esbuild\` release, or a hand edit to the generated file`,
          "run `bun run gen:lint-plugin` and review the diff before committing it",
        ],
      }),
    ],
    "",
  );
}

/** Writes a fresh bundle over the committed one. @public */
export async function writeLintPlugin(config: LintPluginCheckConfig): Promise<void> {
  writeFileSync(resolve(config.root, config.bundle), await bundleLintPlugin(config), "utf-8");
}

if (import.meta.main) {
  const root = resolve(dirname(fileURLToPathish(import.meta.url)), "../../../..");
  await writeLintPlugin({ root, entry: "src/tooling/lint/mod.ts", bundle: "src/tooling/lint/plugin.mjs" });
  console.log("wrote src/tooling/lint/plugin.mjs");
}
