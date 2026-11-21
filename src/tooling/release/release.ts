import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createCommand } from "../cli/command";
import { loadConfigModule } from "../cli/config-module";
import type { Command } from "../cli/types";
import { worktreeChanges } from "../cli/worktree";
import { changelogSectionDigest, formatReleaseDate, parseChangelog, promoteUnreleased, reopenRelease } from "../gate/changelog";
import { isGreaterThan, parseSemVer } from "../gate/semver";
import type { ChangelogParse } from "../gate/types";
import { definitionList } from "../term/grid";
import { DEFAULT_GATE_COMMAND, runGate } from "./gate";
import {
  commit,
  committedPaths,
  createTag,
  currentBranch,
  defaultBranch,
  getLastCommitMessage,
  gitWritable,
  isWorkingTreeClean,
  readFileAtRef,
  remoteTags,
  resolveCommit,
  tagExists,
  tagIsAncestorOfHead,
} from "./git";
import {
  changelogSectionsSource,
  packageWithVersion,
  readChangelog,
  readRepositoryUrl,
  updatePackageVersion,
  writeChangelog,
  writeChangelogSections,
} from "./pkg-json";
import { removedSurfaceSince } from "./surface";
import type { BumpEvidence, GateRecord, ReleaseCommandConfig, ReleaseDeps } from "./types";
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

type ReleaseState = "fresh" | "open" | "committed";

interface HeadRelease {
  pkg: string | null;
  version: string | null;
  changelog: string | null;
  subject: string;
}

interface ReleaseTarget {
  state: ReleaseState;
  /** Whether the release carries a changelog promotion, and so its sections manifest. */
  promotes: boolean;
  /** The date on the `[V]` heading the release carries, or `null` when it has none. */
  date: string | null;
  wasEmpty: boolean;
  /** What each release file must hold, by path; empty for a committed release, which writes nothing. */
  targets: Map<string, string>;
  /** What each release file holds in the working tree now. */
  current: Map<string, string | null>;
}

const RELEASE_SUBJECT = /^chore: release (\S+)$/;

const GATE_RECORD_DIR = ".forge/release";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function blobId(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

function shellWord(word: string): string {
  return /^[\w./@:+-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

function versionOf(manifest: string | null): string | null {
  if (manifest === null) return null;
  try {
    const { version } = JSON.parse(manifest) as { version?: unknown };
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

function releasedDate(changelog: string | null, version: string): string | null {
  if (changelog === null) return null;
  const parsed = parseChangelog(changelog);
  if (!parsed.ok) return null;
  return parsed.data.versions.find((heading) => heading.version === version)?.date ?? null;
}

function isNewer(version: string, previous: string | null): boolean {
  const next = parseSemVer(version);
  const prev = previous === null ? null : parseSemVer(previous);
  return next !== null && prev !== null && isGreaterThan(next, prev);
}

/** Whether `version`'s body still has the digest the sections manifest recorded for it, i.e. nothing edited it since forge wrote both. */
function bodyMatchesManifest(changelog: ChangelogParse, manifest: string | null, version: string): boolean {
  if (!changelog.ok || manifest === null) return false;
  const body = changelog.data.versions.find((heading) => heading.version === version)?.body;
  try {
    const recorded = (JSON.parse(manifest) as Record<string, unknown>)[version];
    return body !== undefined && recorded === changelogSectionDigest(body);
  } catch {
    return false;
  }
}

function newestVersions(changelog: string): string[] {
  const parsed = parseChangelog(changelog);
  return parsed.ok ? parsed.data.versions.map((heading) => heading.version) : [];
}

function isUnreleasedEmpty(changelog: string): boolean {
  const parsed = parseChangelog(changelog);
  return parsed.ok && parsed.data.unreleased.empty;
}

function isReleaseCommit(changed: readonly string[], staged: readonly string[], written: readonly string[]): boolean {
  return (
    changed.length > 0 &&
    changed.every((path) => staged.includes(path)) &&
    written.filter((path) => staged.includes(path)).every((path) => changed.includes(path))
  );
}

function gateRecordCovers(
  record: GateRecord,
  wanted: { version: string; gateCommand: readonly string[]; base: string; files: Record<string, string> },
): boolean {
  const paths = Object.keys(wanted.files);
  return (
    record.version === wanted.version &&
    record.base === wanted.base &&
    record.gateCommand.length === wanted.gateCommand.length &&
    record.gateCommand.every((word, i) => word === wanted.gateCommand[i]) &&
    Object.keys(record.files).length === paths.length &&
    paths.every((path) => record.files[path] === wanted.files[path])
  );
}

function isGateRecord(value: unknown): value is GateRecord {
  if (typeof value !== "object" || value === null) return false;
  const { version, base, files, gateCommand, passedAt } = value as Record<string, unknown>;
  return (
    typeof version === "string" &&
    typeof base === "string" &&
    typeof passedAt === "string" &&
    Array.isArray(gateCommand) &&
    gateCommand.every((word) => typeof word === "string") &&
    typeof files === "object" &&
    files !== null &&
    !Array.isArray(files) &&
    Object.values(files).every((hash) => typeof hash === "string")
  );
}

function isGateRecordPath(path: string): boolean {
  return path.startsWith(`${GATE_RECORD_DIR}/`);
}

function gateRecordPath(cwd: string, tag: string): string {
  return join(cwd, GATE_RECORD_DIR, `${tag}.json`);
}

function readGateRecord(cwd: string, tag: string): GateRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(gateRecordPath(cwd, tag), "utf-8"));
    return isGateRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeGateRecord(cwd: string, tag: string, record: GateRecord): void {
  const path = gateRecordPath(cwd, tag);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
}

/** Creates the CLI command that bumps the version, promotes the changelog, and creates a git tag. */
export function createReleaseCommand(
  config: ReleaseCommandConfig,
  deps: ReleaseDeps = {
    isWorkingTreeClean,
    resolveVersion,
    updatePackageVersion,
    commit,
    committedPaths,
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
    gitWritable,
    readFileAtRef: (cwd, ref, path) => readFileAtRef(cwd, ref, `./${path}`),
    lastCommitSubject: getLastCommitMessage,
    resolveCommit,
    worktreeChanges,
    readWorkingFile: readChangelog,
    readGateRecord,
    writeGateRecord,
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

  const releaseFiles = [...new Set(["package.json", changelogFile, sectionsFile])];

  // Default to exactly what this command wrote: `commit` runs `git add`, so naming a changelog
  // that was never promoted would fail on a project that has none. The manifest is forge's own.
  function stagedFor(promotes: boolean): string[] {
    const derived = promotes ? ["package.json", changelogFile] : ["package.json"];
    return [...new Set([...(stageFiles ?? derived), ...(promotes ? [sectionsFile] : [])])].filter((path) => !isGateRecordPath(path));
  }

  function refuseUntagged(pending: string, refusal: string): never {
    throw new ReleaseError("version-mismatch", `${refusal}\nFinish ${pending} first: run the release again with ${pending}.`);
  }

  function committedRelease(version: string, message: string, head: HeadRelease, working: readonly string[]): ReleaseTarget | null {
    if (head.subject !== message || head.version !== version || releaseFiles.some((path) => working.includes(path))) return null;
    const promotes = head.changelog !== null;
    const written = promotes ? releaseFiles : ["package.json"];
    if (!isReleaseCommit(deps.committedPaths(cwd), stagedFor(promotes), written)) return null;
    return { state: "committed", promotes, date: releasedDate(head.changelog, version), wasEmpty: false, targets: new Map(), current: new Map() };
  }

  function refuseShippedEdits(work: ChangelogParse, head: string | null, version: string): void {
    const shipped = head === null ? null : parseChangelog(head);
    if (shipped === null || !shipped.ok || !work.ok) return;
    const released = (parse: typeof shipped.data) =>
      new Map(
        parse.versions
          .filter((heading) => heading.version !== version)
          .map((heading) => [heading.version, `${heading.date}\n${heading.body.join("\n")}`]),
      );
    const before = released(shipped.data);
    const after = released(work.data);
    const edited = [...new Set([...before.keys(), ...after.keys()])].filter((key) => before.get(key) !== after.get(key));
    if (edited.length === 0) return;
    throw new ReleaseError(
      "release-partial",
      `${changelogFile} changes ${edited.map((key) => `[${key}]`).join(", ")} against HEAD, and those sections shipped with their tags, so the release will not carry the edit.\n` +
        `Restore them from HEAD (\`git show HEAD:./${changelogFile}\` prints it, and works with .git read-only), then release again.`,
    );
  }

  function deriveRelease(
    version: string,
    previousVersion: string | null,
    head: HeadRelease,
    allowEmptyChangelog: boolean,
    since: string,
  ): ReleaseTarget {
    const workPkg = deps.readWorkingFile(cwd, "package.json");
    const workVersion = versionOf(workPkg);
    if (workPkg === null || workVersion === null)
      throw new ReleaseError("pkg-update", "package.json is missing, does not parse, or names no version.");
    if (workVersion !== head.version && workVersion !== version)
      refuseUntagged(
        workVersion,
        `package.json holds ${workVersion} from a release that was written and never committed, so ${version} cannot be released over it.`,
      );
    const pkgTarget = packageWithVersion(workPkg, version);
    if (head.pkg !== null && versionOf(head.pkg) !== null && pkgTarget !== packageWithVersion(head.pkg, version)) {
      throw new ReleaseError(
        "release-partial",
        `package.json changes more than its version against HEAD, and a release commits only the version.\n` +
          "Commit that change first, or restore it with `git show HEAD:./package.json > package.json`, then release again.",
      );
    }

    const current = new Map<string, string | null>([["package.json", workPkg]]);
    const targets = new Map([["package.json", pkgTarget]]);
    const work = deps.readChangelog(cwd, changelogFile);
    if (work === null) {
      return { state: workVersion === version ? "open" : "fresh", promotes: false, date: null, wasEmpty: false, targets, current };
    }

    const parsed = parseChangelog(work);
    if (!parsed.ok) throw new ReleaseError("changelog-malformed", `${changelogFile} could not be parsed:\n  ${parsed.error.join("\n  ")}`);
    const headVersions = head.changelog === null ? [] : newestVersions(head.changelog);
    const workTop = parsed.data.versions[0]?.version;
    if (workTop !== undefined && workTop !== version && isNewer(workTop, previousVersion) && !headVersions.includes(workTop)) {
      refuseUntagged(
        workTop,
        `${changelogFile} holds a [${workTop}] section from a release that was never tagged, so ${version} cannot be released over it.`,
      );
    }
    refuseShippedEdits(parsed, head.changelog, version);

    const reopened = reopenRelease(work, version);
    if (!reopened.ok) throw new ReleaseError("changelog-malformed", `${changelogFile} could not be reopened:\n  ${reopened.error.join("\n  ")}`);
    const wasEmpty = isUnreleasedEmpty(reopened.data);
    if (wasEmpty && !allowEmptyChangelog) {
      throw new ReleaseError(
        "changelog-empty",
        `${changelogFile} has an empty [Unreleased] section, but commits exist since ${since}. ` +
          "Write the entry, or use --allow-empty-changelog for a genuinely entry-free release.",
      );
    }

    const base = deps.readRepositoryUrl(cwd);
    const promote = (date: string) =>
      promoteUnreleased(reopened.data, { version, date, tagPrefix, ...(base !== null ? { compareUrlBase: base } : {}) });
    const writtenDate = releasedDate(work, version);
    const workSections = deps.readWorkingFile(cwd, sectionsFile);
    let date = writtenDate;
    let output = date === null ? null : promote(date);
    const resumed = output !== null && output.ok && output.data === work && bodyMatchesManifest(parsed, workSections, version);
    if (date === null || output === null || !resumed) {
      date = formatReleaseDate(deps.now());
      output = promote(date);
    }
    if (!output.ok) throw new ReleaseError("changelog-malformed", `${changelogFile} could not be promoted:\n  ${output.error.join("\n  ")}`);

    targets.set(changelogFile, output.data);
    targets.set(sectionsFile, changelogSectionsSource(output.data));
    current.set(changelogFile, work);
    current.set(sectionsFile, workSections);
    const fresh = writtenDate === null && workVersion !== version;
    return { state: fresh ? "fresh" : "open", promotes: true, date, wasEmpty, targets, current };
  }

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

      const result = deps.resolveVersion({ ...(explicit !== undefined ? { explicit } : {}), cwd, tagPrefix });

      // The amend floor (BUILD_TOOLING §2j) is otherwise a habit: both invariants are properties of
      // the commit that publishes a release, so this is the last point either can still be answered.
      let published: string[] | null | undefined;
      if (result.previous !== null) {
        if (!deps.tagIsAncestorOfHead(cwd, result.previous)) {
          throw new ReleaseError(
            "history-rewritten",
            `${result.previous} is no longer an ancestor of HEAD — published history was rewritten.\n` +
              `Consumers installed the tarball released at ${result.previous}, so the tag no longer names what they hold, ` +
              "and no version change signals it. Recover the rewritten commits with `git reflog` and rebuild HEAD on top of the tag.",
          );
        }

        published = deps.remoteTags(cwd);
        if (published === null) {
          console.log(`  (remote unreachable — could not confirm ${result.previous} is pushed)`);
        } else if (!published.includes(result.previous) && result.reason !== "in-sync") {
          throw new ReleaseError(
            "tag-unpushed",
            `${result.previous} exists locally but not on the remote, so no consumer can fetch it.\n` +
              `Run \`git push --tags\` before cutting ${result.version} on top of it.`,
          );
        }
      }

      const tag = `${tagPrefix}${result.version}`;

      if (result.reason === "in-sync" || deps.tagExists(cwd, tag)) {
        console.log(
          result.reason === "in-sync" ? `Already at ${result.version} — nothing to release.` : `\nTag ${tag} already exists — nothing to release.`,
        );
        const remote = published === undefined ? deps.remoteTags(cwd) : published;
        if (remote !== null && !remote.includes(tag)) console.log(`${tag} is not on the remote yet. Push it:\n  git push --tags`);
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

      const version = result.version;
      const message = `chore: release ${version}`;
      const previousVersion = result.previous === null ? null : result.previous.slice(result.previous.startsWith(tagPrefix) ? tagPrefix.length : 0);
      const listed = deps.worktreeChanges(cwd);
      if (listed === undefined) throw new ReleaseError("git-error", `Cannot list what the working tree at ${cwd} changes against HEAD.`);
      const working = listed.filter((path) => !isGateRecordPath(path));

      const headPkg = deps.readFileAtRef(cwd, "HEAD", "package.json");
      const head: HeadRelease = {
        pkg: headPkg,
        version: versionOf(headPkg),
        changelog: deps.readFileAtRef(cwd, "HEAD", changelogFile),
        subject: deps.lastCommitSubject(cwd),
      };
      const pending = head.subject.match(RELEASE_SUBJECT)?.[1];
      if (pending !== undefined && pending !== version && pending === head.version && !deps.tagExists(cwd, `${tagPrefix}${pending}`)) {
        refuseUntagged(
          pending,
          `HEAD is the release commit for ${pending}, which was never tagged, so ${version} cannot be released on top of it.`,
        );
      }
      const headTop = head.changelog === null ? undefined : newestVersions(head.changelog)[0];
      if (
        headTop !== undefined &&
        headTop !== version &&
        headTop === head.version &&
        isNewer(headTop, previousVersion) &&
        !deps.tagExists(cwd, `${tagPrefix}${headTop}`)
      ) {
        refuseUntagged(
          headTop,
          `HEAD holds ${headTop} from a release that was committed and never tagged, so ${version} cannot be released on top of it.`,
        );
      }

      const committedTarget = committedRelease(version, message, head, working);

      if (!dry && !allowDirty && !deps.isWorkingTreeClean(cwd)) {
        const allowed = new Set([...releaseFiles, ...(stageFiles ?? [])]);
        const strays = working.filter((path) => !allowed.has(path));
        if (listed.length === 0) {
          throw new ReleaseError("working-tree-dirty", "Working tree is not clean. Commit or stash changes first, or use --allow-dirty.");
        }
        if (strays.length > 0) {
          throw new ReleaseError(
            "working-tree-dirty",
            `Working tree changes ${strays.join(", ")}, which the ${version} release does not carry. Commit or stash them first, or use --allow-dirty.`,
          );
        }
      }

      const target = committedTarget ?? deriveRelease(version, previousVersion, head, allowEmptyChangelog, result.previous ?? "the initial commit");
      const { state } = target;
      const staged = stagedFor(target.promotes);
      const headContent = (path: string): string | null => deps.readFileAtRef(cwd, "HEAD", path);
      const contentOf = (path: string): string | null => target.targets.get(path) ?? deps.readWorkingFile(cwd, path);
      const toCommit =
        state === "committed"
          ? []
          : staged.filter((path) => (target.targets.has(path) ? contentOf(path) !== headContent(path) : working.includes(path)));
      const toWrite = [...target.targets.keys()].filter((path) => target.targets.get(path) !== target.current.get(path));

      let changelogNote = `(no ${changelogFile} — skipped)`;
      if (target.promotes) {
        const allowed = target.wasEmpty ? "  (empty, allowed)" : "";
        if (state === "fresh") changelogNote = `[Unreleased] → [${version}] — ${target.date ?? ""}${allowed}`;
        else if (state === "committed") changelogNote = `[${version}]${target.date !== null ? ` — ${target.date}` : ""}  (already committed)`;
        else
          changelogNote = `[${version}] — ${target.date ?? ""}  (${toWrite.length === 0 ? "already written" : `rewrites ${toWrite.join(", ")}`})${allowed}`;
      }

      const writable = deps.gitWritable(cwd);

      // One definition list rather than four literals whose alignment lived inside the label
      // strings, where renaming one silently misaligned the other three.
      for (const line of definitionList(
        [
          { term: "previous:", description: result.previous ?? "(none)" },
          { term: "next:", description: `${version}  (${result.reason})` },
          ...(result.evidence ? [{ term: "because:", description: becauseRow(result.evidence, result.previous) }] : []),
          { term: "tag:", description: tag },
          { term: "changelog:", description: changelogNote },
          { term: "commit:", description: writable ? "here" : "on the host (.git is read-only)" },
        ],
        { indent: 2, gap: 1 },
      )) {
        console.log(line);
      }

      if (dry) {
        console.log("\nDry run — no changes made.");
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

      const snapshot = (): { base: string; files: Record<string, string> } => {
        const files: Record<string, string> = {};
        for (const path of staged) {
          const content = state === "committed" ? headContent(path) : contentOf(path);
          if (content !== null) files[path] = sha256(content);
        }
        return { base: deps.resolveCommit(cwd, state === "committed" ? "HEAD^" : "HEAD"), files };
      };

      const partWritten = (err: unknown): ReleaseError =>
        new ReleaseError(
          "release-part-written",
          `${staged.join(" and ")} may hold the ${version} release uncommitted: ${err instanceof Error ? err.message : String(err)}\n` +
            "Run the release again: it re-derives the release from the working tree and writes only what still differs.",
        );

      const write = (): void => {
        try {
          if (toWrite.includes("package.json")) deps.updatePackageVersion(version, cwd);
          const changelog = target.targets.get(changelogFile);
          if (changelog !== undefined && toWrite.includes(changelogFile)) deps.writeChangelog(cwd, changelogFile, changelog);
          if (changelog !== undefined && toWrite.includes(sectionsFile)) deps.writeChangelogSections(cwd, sectionsFile, changelog);
        } catch (err) {
          throw partWritten(err);
        }
      };

      // A fresh release gates before it writes, so a red gate leaves nothing behind; any other
      // writes first, so the gate runs over the bytes the release commits.
      if (state === "open") write();

      let gatePassed = false;
      if (!allowUnverified) {
        const spelled = gateCommand.join(" ");
        const record = state === "fresh" ? null : deps.readGateRecord(cwd, tag);
        if (record !== null && gateRecordCovers(record, { version, gateCommand, ...snapshot() })) {
          console.log(`\n\`${spelled}\` already passed on these ${tag} files — not running it again.`);
        } else {
          const nothingWritten = state === "fresh" ? " and nothing was written" : "";
          console.log(`\nRunning \`${spelled}\` before tagging ${tag}…`);
          const outcome = deps.runGate(cwd, gateCommand);
          if (outcome === "unrunnable") {
            throw new ReleaseError(
              "gate-unrunnable",
              `\`${spelled}\` could not be run, so ${tag} was not cut${nothingWritten}.\n` +
                "Name this project's gate with `gateCommand` in the release config, or use --allow-unverified to tag without one.",
            );
          }
          if (outcome === "failed") {
            throw new ReleaseError(
              "gate-failed",
              `\`${spelled}\` failed, so ${tag} was not cut${nothingWritten}.\n` +
                "Fix what it reported and run the release again, or use --allow-unverified to tag anyway.",
            );
          }
          gatePassed = true;
        }
      }

      if (state === "fresh") write();

      if (gatePassed) {
        try {
          deps.writeGateRecord(cwd, tag, { version, ...snapshot(), gateCommand: [...gateCommand], passedAt: deps.now().toISOString() });
        } catch (err) {
          console.log(`  (could not record the gate run, so a resumed release runs it again: ${err instanceof Error ? err.message : String(err)})`);
        }
      }

      if (!writable) {
        const commits = toCommit.length > 0;
        console.log(`\n.git is read-only here, so ${commits ? "commit and tag" : "tag"} ${tag} on the host:`);
        if (commits) {
          const files = toCommit.map(shellWord).join(" ");
          const ids = toCommit.map((path) => blobId(contentOf(path) ?? ""));
          console.log(
            `  test "$(git rev-parse HEAD)" = ${deps.resolveCommit(cwd, "HEAD")} && git hash-object ${files}   # expect ${ids.join(" ")}`,
          );
          console.log(`  git commit -m "${message}" -- ${files}`);
          console.log(`  git tag ${tag}`);
        } else if (state === "committed") {
          console.log(`  git tag ${tag}`);
        } else {
          console.log(`  test "$(git rev-parse HEAD)" = ${deps.resolveCommit(cwd, "HEAD")} && git tag ${tag}`);
        }
        console.log("  git push && git push --tags");
        console.log("Then run `bun run release` here to confirm.");
        return;
      }

      let committed = state === "committed";
      if (toCommit.length > 0) {
        try {
          committed = deps.commit(cwd, message, toCommit);
        } catch (err) {
          if (!(err instanceof ReleaseError && err.kind === "index-stale")) throw partWritten(err);
          committed = true;
          console.log(`  ${err.message}`);
        }
        if (!committed) {
          console.log(`  package.json already at ${version} — skipping commit.`);
        } else {
          const changed = deps.committedPaths(cwd);
          const strays = changed.filter((path) => !toCommit.includes(path));
          if (changed.length === 0 || strays.length > 0) {
            throw new ReleaseError(
              "commit-mismatch",
              `Commit "${message}" changed ${changed.length === 0 ? "no path" : strays.join(", ")} instead of only ${toCommit.join(", ")}, so ${tag} was not cut.\n` +
                "Undo the commit, keeping the release files in the working tree:\n  git reset HEAD^",
            );
          }
        }
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
export const DEFAULT_RELEASE_CONFIG = "config/release.config.ts";

/** Types the default export of a `config/release.config.ts`. @public */
export function defineReleaseConfig(config: Omit<ReleaseCommandConfig, "cwd">): Omit<ReleaseCommandConfig, "cwd"> {
  return config;
}

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

      await createReleaseCommand({ cwd, ...loaded?.value }).run?.(args, flags, ctx);
    },
  });
}
