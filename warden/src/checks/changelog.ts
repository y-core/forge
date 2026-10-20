import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { captureStreams } from "../../../src/tooling/cli/proc";
import { changelogSectionDigest, parseChangelog } from "../../../src/tooling/gate/changelog";
import { checkResult, fail, warn } from "../../../src/tooling/gate/finding";
import { compareSemVer, parseSemVer } from "../../../src/tooling/gate/semver";
import type { ChangelogDocument } from "../../../src/tooling/gate/types";
import type { CheckResult, Finding, SemVer } from "../../../src/tooling/gate/types";

/** What the changelog check needs to know about the project. @public */
export interface ChangelogCheckConfig {
  root: string;
  /** The version `package.json` currently carries — the value the topmost heading must equal. */
  packageVersion: string;
  /** Changelog path relative to `root`. Defaults to `CHANGELOG.md`. */
  file?: string;
  /** Required first line. Defaults to `# Changelog`. */
  title?: string;
  /** Section-digest manifest path relative to `root`. Defaults to `config/changelog-sections.json`; absent, the section check does not run. */
  sectionsFile?: string;
  /** What the release command puts before a version to name its git tag. Defaults to `v`. */
  tagPrefix?: string;
}

// The manifest is what makes "a released section is not edited by hand" checkable offline: the
// release command records each section's digest as it promotes, so a later edit no longer matches.
/** Reports every released section whose prose no longer matches the digest the release recorded. */
function sectionFindings(parsed: ChangelogDocument, sections: Readonly<Record<string, string>> | undefined, file: string): Finding[] {
  if (sections === undefined) return [];
  const findings: Finding[] = [];
  for (const heading of parsed.versions) {
    const recorded = sections[heading.version];
    const digest = changelogSectionDigest(heading.body);
    if (recorded === undefined) {
      findings.push(
        fail(
          `\`${heading.version}\` has no recorded section digest — \`bun run release\` records one as it promotes, so a heading written by hand has none. Move the body under \`## [Unreleased]\` and release it.`,
          { file, line: heading.line + 1 },
        ),
      );
    } else if (recorded !== digest) {
      findings.push(
        fail(
          `\`${heading.version}\`'s section has been edited since it was released — \`[Unreleased]\` is the only section to write in. Move the change there.`,
          { file, line: heading.line + 1 },
        ),
      );
    }
  }
  const headings = new Set(parsed.versions.map((heading) => heading.version));
  for (const version of Object.keys(sections)) {
    if (!headings.has(version))
      findings.push(fail(`a section digest is recorded for \`${version}\`, which the changelog no longer carries`, { file }));
  }
  return findings;
}

/** Reports every released version at or above the oldest heading that the changelog no longer carries a section for. */
function releaseGapFindings(parsed: ChangelogDocument, releasedVersions: readonly string[] | undefined, file: string): Finding[] {
  if (releasedVersions === undefined) return [];
  const headings = parsed.versions.map((heading) => parseSemVer(heading.version)).filter((version) => version !== null);
  const oldest = headings.reduce<SemVer | undefined>(
    (low, version) => (low === undefined || compareSemVer(version, low) < 0 ? version : low),
    undefined,
  );
  if (oldest === undefined) return [];
  const carried = new Set(parsed.versions.map((heading) => heading.version));
  return releasedVersions
    .filter((version) => !carried.has(version))
    .filter((version) => {
      const released = parseSemVer(version);
      return released !== null && compareSemVer(released, oldest) >= 0;
    })
    .map((version) =>
      fail(
        `\`${version}\` was released (its tag exists) but the changelog has no section for it — only the oldest releases may be trimmed. Restore the section and its digest.`,
        { file },
      ),
    );
}

/** Judges a parsed changelog against `packageVersion`, its released sections against `sections`, and its headings against `releasedVersions`. @public */
export function validateChangelog(
  parsed: ChangelogDocument,
  packageVersion: string,
  file: string,
  sections?: Readonly<Record<string, string>>,
  releasedVersions?: readonly string[],
): Finding[] {
  const findings: Finding[] = [...sectionFindings(parsed, sections, file), ...releaseGapFindings(parsed, releasedVersions, file)];

  const seen = new Map<string, number>();
  for (const heading of parsed.versions) {
    const first = seen.get(heading.version);
    if (first !== undefined) {
      findings.push(fail(`duplicate version \`${heading.version}\` (first seen at line ${first})`, { file, line: heading.line + 1 }));
    } else {
      seen.set(heading.version, heading.line + 1);
    }
  }

  for (let i = 1; i < parsed.versions.length; i++) {
    const above = parsed.versions[i - 1];
    const below = parsed.versions[i];
    if (above === undefined || below === undefined) continue;
    const a = parseSemVer(above.version);
    const b = parseSemVer(below.version);
    if (a === null || b === null) continue;
    if (compareSemVer(a, b) <= 0) {
      findings.push(fail(`\`${below.version}\` is not below \`${above.version}\` — versions run newest first`, { file, line: below.line + 1 }));
    }
  }

  for (let i = 1; i < parsed.versions.length; i++) {
    const above = parsed.versions[i - 1];
    const below = parsed.versions[i];
    if (above === undefined || below === undefined) continue;
    if (below.date > above.date) {
      findings.push(
        fail(`\`${below.version}\` is dated ${below.date}, after \`${above.version}\` (${above.date}) above it`, { file, line: below.line + 1 }),
      );
    }
  }

  const topmost = parsed.versions[0];
  if (topmost === undefined) {
    findings.push(warn("no released version headings yet — the version-equality invariant cannot be checked", { file }));
  } else if (topmost.version !== packageVersion) {
    findings.push(
      fail(
        `topmost released version \`${topmost.version}\` does not equal package.json's \`${packageVersion}\` — a released heading was hand-written, or a release was not completed. Move the body under \`## [Unreleased]\` and let the release command promote it.`,
        { file, line: topmost.line + 1 },
      ),
    );
  }

  const headingVersions = new Set(parsed.versions.map((heading) => heading.version));
  for (const version of parsed.linkRefs) {
    if (!headingVersions.has(version)) findings.push(fail(`link definition \`[${version}]\` names a version with no heading`, { file }));
  }
  const defined = new Set(parsed.linkRefs);
  for (const heading of parsed.versions) {
    if (!defined.has(heading.version)) {
      findings.push(warn(`\`[${heading.version}]\` has no link reference definition — it renders as literal text`, { file }));
    }
  }

  return findings;
}

// Absent rather than empty when the file is missing: a project that has not adopted the manifest
// gets the checks it had, where an empty record would report every released section as unrecorded.
/** The recorded section digests, or `undefined` where this project keeps no manifest. */
function readSections(config: ChangelogCheckConfig): Record<string, string> | undefined {
  const path = resolve(config.root, config.sectionsFile ?? "config/changelog-sections.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
}

/** The versions `prefix`-named git tags release, or `undefined` where `root` has no readable tags. */
function readReleasedVersions(root: string, prefix: string): string[] | undefined {
  const listed = captureStreams("git", ["tag", "--list", `${prefix}*`], { cwd: root });
  if (listed.code !== 0) return undefined;
  return listed.stdout
    .split("\n")
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => tag.slice(prefix.length))
    .filter((version) => parseSemVer(version) !== null);
}

/** Reads the changelog and judges it. @public */
export function checkChangelog(config: ChangelogCheckConfig): CheckResult {
  const file = config.file ?? "CHANGELOG.md";
  const title = config.title ?? "# Changelog";
  const path = resolve(config.root, file);

  if (!existsSync(path)) return checkResult([fail("file does not exist", { file })], "");

  const source = readFileSync(path, "utf-8");
  const findings: Finding[] = [];

  if (source.split("\n")[0] !== title) findings.push(fail(`first line is not \`${title}\``, { file, line: 1 }));

  const parsed = parseChangelog(source);
  if (!parsed.ok) {
    findings.push(...parsed.error.map((error) => fail(error, { file })));
    return checkResult(findings, "");
  }

  const released = readReleasedVersions(config.root, config.tagPrefix ?? "v");
  findings.push(...validateChangelog(parsed.data, config.packageVersion, file, readSections(config), released));

  return checkResult(findings, `${file} verified — ${parsed.data.versions.length} released versions, newest first, matching package.json.`);
}
