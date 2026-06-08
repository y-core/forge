import { exit } from "node:process";
import { createCommand } from "../cli/command";
import type { Command } from "../cli/types";
import { commit, createTag, isWorkingTreeClean } from "./git";
import { updatePackageVersion } from "./pkg";
import type { ReleaseCommandConfig, ReleaseDeps } from "./types";
import { resolveVersion } from "./version";

const releaseFlags = {
  dry: { type: "boolean" as const, short: "n", description: "Show what would happen without making changes" },
  "allow-dirty": { type: "boolean" as const, description: "Skip clean working tree check" },
};

export function createReleaseCommand(
  config: ReleaseCommandConfig,
  deps: ReleaseDeps = { isWorkingTreeClean, resolveVersion, updatePackageVersion, commit, createTag },
): Command<typeof releaseFlags> {
  const { cwd, tagPrefix = "v", stageFiles = ["package.json"] } = config;

  return createCommand({
    name: "release",
    description: "Bump version, update package files, and create a git tag",
    flags: releaseFlags,
    args: { kind: "range", min: 0, max: 1 },
    run(args, flags) {
      const explicit = args[0];
      const dry = Boolean(flags.dry);
      const allowDirty = Boolean(flags["allow-dirty"]);

      if (!dry && !allowDirty && !deps.isWorkingTreeClean(cwd)) {
        console.error("Error: Working tree is not clean. Commit or stash changes first, or use --allow-dirty.");
        exit(1);
      }

      const result = deps.resolveVersion({ ...(explicit !== undefined ? { explicit } : {}), cwd, tagPrefix });

      if (result.reason === "in-sync") {
        console.log(`Already at ${result.version} — nothing to release.`);
        return;
      }

      const tag = `${tagPrefix}${result.version}`;
      console.log(`  previous: ${result.previous ?? "(none)"}`);
      console.log(`  next:     ${result.version}  (${result.reason})`);
      console.log(`  tag:      ${tag}`);

      if (dry) {
        console.log("\nDry run — no changes made.");
        return;
      }

      deps.updatePackageVersion(result.version, cwd);
      deps.commit(cwd, `chore: release ${result.version}`, stageFiles);
      deps.createTag(cwd, tag);

      console.log(`\nTagged ${tag}. Push:`);
      console.log(`  git push && git push --tags`);
    },
  });
}
