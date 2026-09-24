import { createCommand } from "../cli/command";
import { loadConfigModule } from "../cli/config-module";
import type { Command } from "../cli/types";
import { formatReleaseDate, parseChangelog, promoteUnreleased } from "../gate/changelog";
import { definitionList } from "../term/grid";
import { DEFAULT_GATE_COMMAND, runGate } from "./gate";
import { commit, createTag, currentBranch, defaultBranch, isWorkingTreeClean, remoteTags, tagExists, tagIsAncestorOfHead } from "./git";
import { readChangelog, readRepositoryUrl, updatePackageVersion, writeChangelog, writeChangelogSections } from "./pkg-json";
import { removedSurfaceSince } from "./surface";
import type { BumpEvidence, ReleaseCommandConfig, ReleaseDeps } from "./types";
import { ReleaseError } from "./types";
import { resolveVersion } from "./version";

const releaseFlags = {
  dry: { type: "boolean" as const, short: "n", description: "Show what would happen without making changes" },
  "allow-dirty": { type: "boolean" as const, description: "Skip clean working tree check" },
  "allow-empty-changelog": { type: "boolean" as const, description: "Release even though [Unreleased] carries no entry" },
  "allow-semver": { type: "boolean" as const, description: "Release despite a shrinking public export surface" },
  "allow-branch": { type: "boolean" as const, description: "Release from a branch other than the one the remote publishes from" },
  "allow-unverified": { type: "boolean" as const, description: "Release without running the verification gate first" },
};

function becauseRow(evidence: BumpEvidence, previous: string | null): string {
  if (evidence.commit) return `${evidence.commit.sha} ${evidence.commit.subject}`;
  const commits = `${evidence.commitCount} commit${evidence.commitCount === 1 ? "" : "s"}`;
  return `no major:/minor: subject in ${commits} since ${previous ?? "the initial commit"}`;
}

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
    writeChangelogSections,
    readRepositoryUrl,
    removedSurfaceSince,
    tagIsAncestorOfHead,
    remoteTags,
    currentBranch,
    defaultBranch,
    runGate,
    now: () => new Date(),
  },
): Command<typeof releaseFlags> {
  const {
    cwd,
    tagPrefix = "v",
    stageFiles,
    changelogFile = "CHANGELOG.md",
    sectionsFile = "config/changelog-sections.json",
    gateCommand = [...DEFAULT_GATE_COMMAND],
  } = config;

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
      const allowSemver = Boolean(flags["allow-semver"]);
      const allowBranch = Boolean(flags["allow-branch"]);
      const allowUnverified = Boolean(flags["allow-unverified"]);

      if (!dry && !allowDirty && !deps.isWorkingTreeClean(cwd)) {
        throw new ReleaseError("working-tree-dirty", "Working tree is not clean. Commit or stash changes first, or use --allow-dirty.");
      }

      const result = deps.resolveVersion({ ...(explicit !== undefined ? { explicit } : {}), cwd, tagPrefix });

      // The amend floor (BUILD_TOOLING §2j) is otherwise a habit: both invariants are properties of
      // the commit that publishes a release, so this is the last point either can still be answered.
      if (result.previous !== null) {
        if (!deps.tagIsAncestorOfHead(cwd, result.previous)) {
          throw new ReleaseError(
            "history-rewritten",
            `${result.previous} is no longer an ancestor of HEAD — published history was rewritten.\n` +
              `Consumers fetch a codeload tarball at ${result.previous}, so the commits they already hold no longer match the tag, ` +
              "and no version change signals it. Recover the rewritten commits with `git reflog` and rebuild HEAD on top of the tag.",
          );
        }

        const published = deps.remoteTags(cwd);
        if (published === null) {
          console.log(`  (remote unreachable — could not confirm ${result.previous} is pushed)`);
        } else if (!published.includes(result.previous)) {
          throw new ReleaseError(
            "tag-unpushed",
            `${result.previous} exists locally but not on the remote, so no consumer can fetch it.\n` +
              `Run \`git push --tags\` before cutting ${result.version} on top of it.`,
          );
        }
      }

      if (result.reason === "in-sync") {
        console.log(`Already at ${result.version} — nothing to release.`);
        return;
      }

      if (!allowSemver && result.reason === "auto-patch" && result.previous !== null) {
        const removed = deps.removedSurfaceSince(cwd, result.previous);
        if (removed.length > 0) {
          throw new ReleaseError(
            "surface-shrink",
            `Public export surface shrank since ${result.previous}, but the resolved bump is auto-patch:\n` +
              `${removed.map((entry) => `  ${entry}`).join("\n")}\n` +
              "Give the commit that removed them a `minor:` subject prefix (`major:` from 1.0) — that prefix is the only signal a consumer pinning by tag gets.\n" +
              "--allow-semver overrides this deliberately, for a shrink where a patch bump is genuinely correct.",
          );
        }
      }

      const tag = `${tagPrefix}${result.version}`;

      const raw = deps.readChangelog(cwd, changelogFile);
      let promoted: string | null = null;
      let changelogNote = `(no ${changelogFile} — skipped)`;

      if (raw !== null) {
        const parsed = parseChangelog(raw);
        if (!parsed.ok) {
          throw new ReleaseError("changelog-malformed", `${changelogFile} could not be parsed:\n  ${parsed.error.join("\n  ")}`);
        }

        const wasEmpty = parsed.data.unreleased.empty;
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
          throw new ReleaseError("changelog-malformed", `${changelogFile} could not be promoted:\n  ${output.error.join("\n  ")}`);
        }

        promoted = output.data;
        changelogNote = `[Unreleased] → [${result.version}] — ${date}${wasEmpty ? "  (empty, allowed)" : ""}`;
      }

      // One definition list rather than four literals whose alignment lived inside the label
      // strings, where renaming one silently misaligned the other three.
      for (const line of definitionList(
        [
          { term: "previous:", description: result.previous ?? "(none)" },
          { term: "next:", description: `${result.version}  (${result.reason})` },
          ...(result.evidence ? [{ term: "because:", description: becauseRow(result.evidence, result.previous) }] : []),
          { term: "tag:", description: tag },
          { term: "changelog:", description: changelogNote },
        ],
        { indent: 2, gap: 1 },
      )) {
        console.log(line);
      }

      if (dry) {
        console.log("\nDry run — no changes made.");
        return;
      }

      if (deps.tagExists(cwd, tag)) {
        console.log(`\nTag ${tag} already exists — nothing to release.`);
        return;
      }

      // The tag is the publish trigger and CI runs the gate only after it is public, so a red gate
      // there leaves a fetchable tag with no asset and a version that cannot be reused.
      if (!allowBranch) {
        const branch = deps.currentBranch(cwd);
        // Answered without the remote, so it is answered whether or not the remote answers its own.
        if (branch === null) {
          throw new ReleaseError(
            "wrong-branch",
            "HEAD is detached, so the release commit would sit on no branch.\n" +
              "`git push` would then push nothing while `git push --tags` published a tag no branch carries. " +
              "Check out the branch you are releasing, or use --allow-branch.",
          );
        }
        const publishesFrom = deps.defaultBranch(cwd);
        if (publishesFrom === null) {
          console.log(`  (remote names no publishing branch — could not confirm ${branch} is the one it publishes from)`);
        } else if (branch !== publishesFrom) {
          throw new ReleaseError(
            "wrong-branch",
            `HEAD is on ${branch}, and the remote publishes from ${publishesFrom}.\n` +
              `A tag cut here publishes commits ${publishesFrom} does not carry. Switch branch, or use --allow-branch.`,
          );
        }
      }

      if (!allowUnverified) {
        const spelled = gateCommand.join(" ");
        console.log(`\nRunning \`${spelled}\` before tagging ${tag}…`);
        const outcome = deps.runGate(cwd, gateCommand);
        if (outcome === "unrunnable") {
          throw new ReleaseError(
            "gate-unrunnable",
            `\`${spelled}\` could not be run, so ${tag} was not cut and nothing was written.\n` +
              "Name this project's gate with `gateCommand` in the release config, or use --allow-unverified to tag without one.",
          );
        }
        if (outcome === "failed") {
          throw new ReleaseError(
            "gate-failed",
            `\`${spelled}\` failed, so ${tag} was not cut and nothing was written.\n` +
              "Fix what it reported and run the release again, or use --allow-unverified to tag anyway.",
          );
        }
      }

      // Default to exactly what this command wrote: `commit` runs `git add`, so naming a changelog
      // that was never promoted would fail on a project that has none. The manifest is forge's own.
      const derived = promoted !== null ? ["package.json", changelogFile] : ["package.json"];
      const staged = [...new Set([...(stageFiles ?? derived), ...(promoted !== null ? [sectionsFile] : [])])];
      const message = `chore: release ${result.version}`;
      let committed: boolean;
      try {
        deps.updatePackageVersion(result.version, cwd);
        if (promoted !== null) {
          deps.writeChangelog(cwd, changelogFile, promoted);
          deps.writeChangelogSections(cwd, sectionsFile, promoted);
        }
        committed = deps.commit(cwd, message, staged);
      } catch (err) {
        // Without the recovery named here, the next run refuses as dirty, and forcing it past that
        // promotes the changelog a second time under the same heading.
        throw new ReleaseError(
          "release-part-written",
          `${staged.join(" and ")} may hold the ${result.version} release uncommitted: ${err instanceof Error ? err.message : String(err)}\n` +
            `Undo the write before releasing again:\n  git checkout -- ${staged.join(" ")}`,
        );
      }
      if (!committed) {
        console.log(`  package.json already at ${result.version} — skipping commit.`);
      }

      try {
        deps.createTag(cwd, tag);
      } catch (err) {
        const landed = committed ? `Commit "${message}" landed unpushed and untagged; ` : "";
        throw new ReleaseError("git-error", `${landed}creating tag ${tag} failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      console.log(`\nTagged ${tag}. Push:`);
      console.log(`  git push && git push --tags`);
    },
  });
}

/** Where `forge release` looks for its configuration when `--config` names none. @public */
export const DEFAULT_RELEASE_CONFIG = "config/release.ts";

const releaseBinFlags = {
  ...releaseFlags,
  config: { type: "string" as const, description: `Release config module (default: ${DEFAULT_RELEASE_CONFIG}, optional)` },
  root: { type: "string" as const, description: "Repository working directory (default: the working directory)" },
};

/** Builds the `forge release` CLI `Command`, whose config module is optional. @public */
export function createReleaseBinCommand(): Command<typeof releaseBinFlags> {
  return createCommand({
    name: "release",
    description: "Bump version, promote the changelog, and create a git tag",
    flags: releaseBinFlags,
    args: { kind: "range", min: 0, max: 1 },
    async run(args, flags, ctx) {
      const cwd = flags.root ?? process.cwd();
      const loaded = await loadConfigModule<Omit<ReleaseCommandConfig, "cwd">>({
        root: cwd,
        path: flags.config ?? DEFAULT_RELEASE_CONFIG,
        explicit: flags.config !== undefined,
        what: "release config",
      });

      await createReleaseCommand({ cwd, ...loaded }).run?.(args, flags, ctx);
    },
  });
}
