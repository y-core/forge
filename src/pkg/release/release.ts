import { createCommand } from "../../cli/command";
import type { Command } from "../../cli/types";
import { loadConfigModule } from "../internal/config-module";
import { commit, createTag, isWorkingTreeClean, tagExists } from "../internal/git";
import { readChangelog, readRepositoryUrl, updatePackageVersion, writeChangelog } from "../internal/pkg-json";
import type { ReleaseCommandConfig, ReleaseDeps } from "../types";
import { ReleaseError } from "../types";
import { formatReleaseDate, parseChangelog, promoteUnreleased } from "./changelog";
import { resolveVersion } from "./version";

const releaseFlags = {
  dry: { type: "boolean" as const, short: "n", description: "Show what would happen without making changes" },
  "allow-dirty": { type: "boolean" as const, description: "Skip clean working tree check" },
  "allow-empty-changelog": { type: "boolean" as const, description: "Release even though [Unreleased] carries no entry" },
};

/** Creates the CLI command that bumps the version, promotes the changelog, and creates a git tag. */
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
  const { cwd, tagPrefix = "v", stageFiles, changelogFile = "CHANGELOG.md" } = config;

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

      if (!dry && !allowDirty && !deps.isWorkingTreeClean(cwd)) {
        throw new ReleaseError("working-tree-dirty", "Working tree is not clean. Commit or stash changes first, or use --allow-dirty.");
      }

      const result = deps.resolveVersion({ ...(explicit !== undefined ? { explicit } : {}), cwd, tagPrefix });

      if (result.reason === "in-sync") {
        console.log(`Already at ${result.version} — nothing to release.`);
        return;
      }

      const tag = `${tagPrefix}${result.version}`;

      const raw = deps.readChangelog(cwd, changelogFile);
      let promoted: string | null = null;
      let changelogNote = `(no ${changelogFile} — skipped)`;

      if (raw !== null) {
        const parsed = parseChangelog(raw);
        if (!parsed.ok) {
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

        const date = formatReleaseDate(deps.now());
        const base = deps.readRepositoryUrl(cwd);
        const output = promoteUnreleased(raw, { version: result.version, date, tagPrefix, ...(base !== null ? { compareUrlBase: base } : {}) });
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
      // Default to exactly what this command wrote: `commit` runs `git add`, so naming a changelog
      // that was never promoted would fail on a project that has none.
      const staged = stageFiles ?? (promoted !== null ? ["package.json", changelogFile] : ["package.json"]);
      const committed = deps.commit(cwd, `chore: release ${result.version}`, staged);
      if (!committed) {
        console.log(`  package.json already at ${result.version} — skipping commit.`);
      }
      deps.createTag(cwd, tag);

      console.log(`\nTagged ${tag}. Push:`);
      console.log(`  git push && git push --tags`);
    },
  });
}

/** Where `forge-release` looks for its configuration when `--config` names none. @public */
export const DEFAULT_RELEASE_CONFIG = "config/release.ts";

const releaseBinFlags = {
  ...releaseFlags,
  config: { type: "string" as const, description: `Release config module (default: ${DEFAULT_RELEASE_CONFIG}, optional)` },
  root: { type: "string" as const, description: "Repository working directory (default: the working directory)" },
};

/** Builds the `forge-release` CLI `Command`. Its config module is optional — a project needing no
 *  override releases with the defaults. Delegates to {@link createReleaseCommand}. @public */
export function createReleaseBinCommand(): Command<typeof releaseBinFlags> {
  return createCommand({
    name: "forge-release",
    description: "Bump version, promote the changelog, and create a git tag",
    flags: releaseBinFlags,
    args: { kind: "range", min: 0, max: 1 },
    async run(args, flags) {
      const cwd = flags.root ?? process.cwd();
      const loaded = await loadConfigModule<Omit<ReleaseCommandConfig, "cwd">>({
        root: cwd,
        path: flags.config ?? DEFAULT_RELEASE_CONFIG,
        explicit: flags.config !== undefined,
        what: "release config",
      });

      await createReleaseCommand({ cwd, ...loaded }).run?.(args, flags);
    },
  });
}
