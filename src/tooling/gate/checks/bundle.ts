import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { type CheckResult, checkResult, fail } from "../finding";
import { fileURLToPathish } from "./design-system";

/** What a bundle-drift check needs to know about the project. @public */
export interface BundleCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** The TypeScript entry, relative to `root`. */
  entry: string;
  /** The committed bundle node loads, relative to `root`. */
  bundle: string;
  /** The command that regenerates the bundle, named in the banner and in every failure. */
  fixer: string;
}

/** Whether `esbuild` can be resolved — a bundle cannot be rebuilt without it, and it is an optional peer. @public */
export function hasEsbuild(): boolean {
  try {
    import.meta.resolve("esbuild");
    return true;
  } catch {
    return false;
  }
}

/** Bundles an entry into the single self-contained ES module node loads. @public */
export async function bundleSource(config: BundleCheckConfig): Promise<string> {
  const esbuild = (await import("esbuild")) as typeof import("esbuild");
  const result = await esbuild.build({
    entryPoints: [resolve(config.root, config.entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    // Node refuses to strip types under `node_modules`, so a consumer can only load a plain `.mjs`.
    // The banner is what tells a reader of that file not to edit it.
    banner: { js: `// Generated from ${config.entry} by \`${config.fixer}\` — do not edit.` },
  });
  return result.outputFiles[0]?.text ?? "";
}

/** Rebuilds a bundle and reports any drift from the committed copy. @public */
export async function checkBundle(config: BundleCheckConfig): Promise<CheckResult> {
  const expected = await bundleSource(config);
  const path = resolve(config.root, config.bundle);

  let actual: string;
  try {
    actual = readFileSync(path, "utf-8");
  } catch {
    return checkResult([fail("the committed bundle is missing", { file: config.bundle, detail: [`run \`${config.fixer}\``] })], "");
  }

  if (actual === expected) return checkResult([], `${config.bundle} matches a fresh bundle of ${config.entry}`);

  return checkResult(
    [
      fail("the committed bundle no longer matches its source", {
        file: config.bundle,
        detail: [
          `\`${config.entry}\` now bundles to something else — a source edit, an \`esbuild\` release, or a hand edit to the generated file`,
          `run \`${config.fixer}\` and review the diff before committing it`,
        ],
      }),
    ],
    "",
  );
}

/** Writes a fresh bundle over the committed one. @public */
export async function writeBundle(config: BundleCheckConfig): Promise<void> {
  writeFileSync(resolve(config.root, config.bundle), await bundleSource(config), "utf-8");
}

if (import.meta.main) {
  const root = resolve(dirname(fileURLToPathish(import.meta.url)), "../../../..");
  const fixer = "bun run gen:bundles";
  for (const [entry, bundle] of [
    ["src/tooling/lint/mod.ts", "src/tooling/lint/plugin.mjs"],
    ["src/tooling/gate/checks/chromium.ts", "src/tooling/gate/chromium.mjs"],
  ] as const) {
    await writeBundle({ root, entry, bundle, fixer });
    console.log(`wrote ${bundle}`);
  }
}
