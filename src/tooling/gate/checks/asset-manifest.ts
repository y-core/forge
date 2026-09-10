import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "../../assets/config";
import { readEmittedManifest } from "../../assets/pipeline";
import { checkResult, fail } from "../finding";
import type { CheckResult, Finding } from "../types";
import type { GateMode } from "../types";
import type { AssetManifestCheckConfig } from "./types";

const BUILD_HINT = "run `forge assets build --minify` — the manifest is ahead of the built tree";

/** Checks every path the emitted assets manifest maps to exists under `publicDir`. The types-only
 *  artifact is tolerated in `fast` alone — `standard` and `full` both fail it, because a manifest
 *  nothing has built is exactly what a run that closes a task has to catch. @public */
export async function checkAssetManifest(config: AssetManifestCheckConfig, mode: GateMode): Promise<CheckResult> {
  const { root } = config;
  const assetsPath = config.assetsPath ?? ".forge/assets.ts";
  const modulePath = resolve(root, assetsPath);

  // `types:assets` runs immediately before and always writes when the file is absent, so an absent
  // module here is a genuine breakage rather than a tree nobody has built yet.
  if (!existsSync(modulePath)) {
    return checkResult([fail(`\`${assetsPath}\` not found`, { file: assetsPath, detail: [BUILD_HINT] })], "asset manifest: no emitted module");
  }

  const { typesOnly, data } = readEmittedManifest(readFileSync(modulePath, "utf-8"));

  if (data === null) {
    return checkResult(
      [fail(`\`${assetsPath}\` declares no \`DATA\` block, so it is not an emitted assets module`, { file: assetsPath, detail: [BUILD_HINT] })],
      "asset manifest: not an emitted module",
    );
  }

  if (typesOnly) {
    if (mode === "fast") return checkResult([], "asset manifest: types-only artifact, nothing to verify");
    return checkResult(
      [
        fail(`\`${assetsPath}\` is the types-only artifact, whose paths are logical names no build has produced`, {
          file: assetsPath,
          detail: ["run `forge assets build --minify` — only a fast run accepts an artifact that was never built"],
        }),
      ],
      "asset manifest: types-only artifact",
    );
  }

  const resolved = await loadConfig({ root, configPath: config.assetConfig });
  const publicDir = resolved.paths.publicDir;

  const entries = Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return checkResult([], "asset manifest: empty, nothing to verify");

  const findings: Finding[] = [];
  for (const [key, value] of entries) {
    if (existsSync(resolve(root, publicDir, value))) continue;
    findings.push(fail(`\`${key}\` maps to \`${value}\`, which is not under \`${publicDir}\``, { file: assetsPath, detail: [BUILD_HINT] }));
  }

  return checkResult(findings, `asset manifest: ${entries.length} entries verified under \`${publicDir}\``);
}
