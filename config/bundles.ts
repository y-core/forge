import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "../package.json" with { type: "json" };
import { nodeBundles, writeBundle } from "../src/tooling/gate/checks/bundle";
import type { BundleCheckConfig, NodeBundle, NodeManifest } from "../src/tooling/gate/checks/types";

/** The verb that regenerates every bundle, named in each one's banner and in its drift finding. */
export const BUNDLE_FIXER = "bun run gen:bundles";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Each surface a node process imports, derived from `forge.node` and prebuilt because node refuses to strip types under `node_modules`. */
export const BUNDLES: readonly NodeBundle[] = nodeBundles(ROOT, pkg as NodeManifest);

/** Regenerates every bundle on the list under `root`, through `write` so a test can record the calls. */
export async function writeBundles(root: string, write: (config: BundleCheckConfig) => Promise<void> = writeBundle): Promise<void> {
  for (const { entry, bundle } of BUNDLES) {
    await write({ root, entry, bundle, fixer: BUNDLE_FIXER });
    console.log(`wrote ${bundle}`);
  }
}

if (import.meta.main) await writeBundles(ROOT);
