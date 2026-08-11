import { createCommand } from "../cli/command";
import type { Command } from "../cli/types";
import { formatReleaseDate, parseChangelog, promoteUnreleased } from "./changelog";
import { commit, createTag, isWorkingTreeClean, tagExists } from "./git";
import { readChangelog, readRepositoryUrl, updatePackageVersion, writeChangelog } from "./pkg";
import type { ReleaseCommandConfig, ReleaseDeps } from "./types";
import { ReleaseError } from "./types";
import { resolveVersion } from "./version";

const releaseFlags = {
  dry: { type: "boolean" as const, short: "n", description: "Show what would happen without making changes" },
  "allow-dirty": { type: "boolean" as const, description: "Skip clean working tree check" },
  "allow-empty-changelog": { type: "boolean" as const, description: "Release even though [Unreleased] carries no entry" },
};

export function createReleaseCommand(
  config: ReleaseCommandConfig,
  deps: ReleaseDeps = {
    isWorkingTreeClean,
    resolveVersion,
    updatePackageVersion,
    commit,
    tagExists,
    createTag,
    readChangelog,
    writeChangelog,
    readRepositoryUrl,
    now: () => new Date(),
  },
): Command<typeof releaseFlags> {
  const { cwd, tagPrefix = "v", stageFiles = ["package.json"], changelogFile = "CHANGELOG.md" } = config;

  return createCommand({
    name: "release",
    description: "Bump version, promote the changelog, and create a git tag",
    flags: releaseFlags,
    args: { kind: "range", min: 0, max: 1 },
    run(args, flags) {
      const explicit = args[0];
      const dry = Boolean(flags.dry);
      const allowDirty = Boolean(flags["allow-dirty"]);
      const allowEmptyChangelog = Boolean(flags["allow-empty-changelog"]);

      // Refusals `throw` rather than calling `exit(1)`: `execute()` renders any `Error` as
      // `Error: <message>` and exits 1, so the output is unchanged and the guard stays reachable
      // from a test without mocking `node:process`.
      if (!dry && !allowDirty && !deps.isWorkingTreeClean(cwd)) {
        throw new ReleaseError("working-tree-dirty", "Working tree is not clean. Commit or stash changes first, or use --allow-dirty.");
      }

      const result = deps.resolveVersion({ ...(explicit !== undefined ? { explicit } : {}), cwd, tagPrefix });

      if (result.reason === "in-sync") {
        console.log(`Already at ${result.version} — nothing to release.`);
        return;
      }

      const tag = `${tagPrefix}${result.version}`;

      // The changelog verdict is reached before the `--dry` return, so a dry run reports the
      // refusal it would raise, and before `updatePackageVersion`, so no mutation precedes it.
      const raw = deps.readChangelog(cwd, changelogFile);
      let promoted: string | null = null;
      let changelogNote = `(no ${changelogFile} — skipped)`;

      if (raw !== null) {
        const parsed = parseChangelog(raw);
        if (!parsed.ok) {
          // Deliberately not covered by `--allow-empty-changelog`: that flag licenses an empty
          // section, not an unparseable document, and promotion cannot proceed on one.
          throw new ReleaseError("changelog-malformed", `${changelogFile} could not be parsed:\n  ${parsed.errors.join("\n  ")}`);
        }

        const wasEmpty = parsed.unreleased.empty;
        if (wasEmpty && !allowEmptyChangelog) {
          throw new ReleaseError(
            "changelog-empty",
            `${changelogFile} has an empty [Unreleased] section, but commits exist since ${result.previous ?? "the initial commit"}. ` +
              "Write the entry, or use --allow-empty-changelog for a genuinely entry-free release.",
          );
        }

        // Promotion runs even under `--allow-empty-changelog`. Skipping it would leave the
        // topmost released heading behind `package.json`, turning the escape hatch into a gate
        // failure on the next `verify`; a permanent `_Nothing yet._` section is the deterrent.
        const date = formatReleaseDate(deps.now());
        const base = deps.readRepositoryUrl(cwd);
        const output = promoteUnreleased(raw, { version: result.version, date, tagPrefix, ...(base !== null ? { compareUrlBase: base } : {}) });
        // `parseChangelog` already succeeded above, so promotion cannot fail — but the type is a
        // union and narrowing it by assertion would be the one place a real failure went silent.
        if (!output.ok) {
          throw new ReleaseError("changelog-malformed", `${changelogFile} could not be promoted:\n  ${output.errors.join("\n  ")}`);
        }

        promoted = output.source;
        changelogNote = `[Unreleased] → [${result.version}] — ${date}${wasEmpty ? "  (empty, allowed)" : ""}`;
      }

      console.log(`  previous:  ${result.previous ?? "(none)"}`);
      console.log(`  next:      ${result.version}  (${result.reason})`);
      console.log(`  tag:       ${tag}`);
      console.log(`  changelog: ${changelogNote}`);

      if (dry) {
        console.log("\nDry run — no changes made.");
        return;
      }

      if (deps.tagExists(cwd, tag)) {
        console.log(`\nTag ${tag} already exists — nothing to release.`);
        return;
      }

      deps.updatePackageVersion(result.version, cwd);
      if (promoted !== null) deps.writeChangelog(cwd, changelogFile, promoted);
      const committed = deps.commit(cwd, `chore: release ${result.version}`, stageFiles);
      if (!committed) {
        console.log(`  package.json already at ${result.version} — skipping commit.`);
      }
      deps.createTag(cwd, tag);

      console.log(`\nTagged ${tag}. Push:`);
      console.log(`  git push && git push --tags`);
    },
  });
}
