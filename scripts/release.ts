import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCommand, execute } from "../src/cli/mod";
import { isWorkingTreeClean, createTag, resolveVersion, updatePackageVersion } from "../src/pkg/mod";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TAG_PREFIX = "v";

const release = createCommand({
  name: "release",
  description: "Bump version, update package files, and create a git tag",
  flags: {
    dry: { type: "boolean", short: "n", description: "Show what would happen without making changes" },
    "allow-dirty": { type: "boolean", description: "Skip clean working tree check" },
  },
  args: { kind: "range", min: 0, max: 1 },
  run(args, flags) {
    const explicit = args[0];
    const dry = Boolean(flags.dry);
    const allowDirty = Boolean(flags["allow-dirty"]);

    if (!dry && !allowDirty && !isWorkingTreeClean(ROOT)) {
      console.error("Error: Working tree is not clean. Commit or stash changes first, or use --allow-dirty.");
      process.exit(1);
    }

    const result = resolveVersion({ explicit, cwd: ROOT, tagPrefix: TAG_PREFIX });

    if (result.reason === "in-sync") {
      console.log(`Already at ${result.version} — nothing to release.`);
      return;
    }

    const tag = `${TAG_PREFIX}${result.version}`;
    console.log(`  previous: ${result.previous ?? "(none)"}`);
    console.log(`  next:     ${result.version}  (${result.reason})`);
    console.log(`  tag:      ${tag}`);

    if (dry) {
      console.log("\nDry run — no changes made.");
      return;
    }

    updatePackageVersion(result.version, ROOT);
    createTag(ROOT, tag);

    console.log(`\nTagged ${tag}. Stage and commit the version bump files, then push:`);
    console.log(`  git add package.json package-lock.json`);
    console.log(`  git commit -m "chore: release ${result.version}"`);
    console.log(`  git push && git push --tags`);
  },
});

await execute(release);
