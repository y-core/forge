import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { writeBundle } from "../src/tooling/gate/checks/bundle";
import type { BundleCheckConfig } from "../src/tooling/gate/checks/types";

/** The verb that regenerates every bundle, named in each one's banner and in its drift finding. */
export const BUNDLE_FIXER = "bun run gen:bundles";

/** Each surface a node process imports, prebuilt because node refuses to strip types under `node_modules`. */
export const BUNDLES: readonly { label: string; entry: string; bundle: string; watches: readonly string[] }[] = [
  { label: "validate-lint-plugin", entry: "src/tooling/lint/mod.ts", bundle: "src/tooling/lint/plugin.mjs", watches: ["src/tooling/lint/**"] },
  {
    label: "validate-chromium-bundle",
    entry: "src/tooling/gate/checks/chromium.ts",
    bundle: "src/tooling/gate/chromium.mjs",
    watches: ["src/tooling/gate/checks/chromium.ts", "src/tooling/gate/chromium.mjs"],
  },
  {
    label: "validate-totp-bundle",
    entry: "src/testing/totp.ts",
    bundle: "src/testing/totp.mjs",
    watches: ["src/testing/totp.ts", "src/crypto/primitives/base32.ts", "src/crypto/primitives/hotp.ts", "src/testing/totp.mjs"],
  },
  {
    label: "validate-wrangler-bundle",
    entry: "src/tooling/cf/wrangler.ts",
    bundle: "src/tooling/cf/wrangler.mjs",
    watches: [
      "src/tooling/cf/wrangler.ts",
      "src/tooling/cf/types.ts",
      "src/tooling/cf/config/**",
      "src/tooling/cli/**",
      "src/validation/**",
      "src/result/**",
      "src/tooling/cf/wrangler.mjs",
    ],
  },
];

/** Regenerates every bundle on the list under `root`, through `write` so a test can record the calls. */
export async function writeBundles(root: string, write: (config: BundleCheckConfig) => Promise<void> = writeBundle): Promise<void> {
  for (const { entry, bundle } of BUNDLES) {
    await write({ root, entry, bundle, fixer: BUNDLE_FIXER });
    console.log(`wrote ${bundle}`);
  }
}

if (import.meta.main) await writeBundles(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
