import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type ChangelogParse, parseChangelog } from "../../release/changelog";
import { compareSemVer, parseSemVer } from "../../release/semver";
import { type CheckResult, checkResult, type Finding, fail, warn } from "../finding";

/** What the changelog check needs to know about the project. @public */
export interface ChangelogCheckConfig {
  root: string;
  /** The version `package.json` currently carries — the value the topmost heading must equal. */
  packageVersion: string;
  /** Changelog path relative to `root`. Defaults to `CHANGELOG.md`. */
  file?: string;
  /** Required first line. Defaults to `# Changelog`. */
  title?: string;
}

/** Judges a parsed changelog against `packageVersion`. @public */
export function validateChangelog(parsed: Extract<ChangelogParse, { ok: true }>, packageVersion: string, file: string): Finding[] {
  const findings: Finding[] = [];

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
    findings.push(...parsed.errors.map((error) => fail(error, { file })));
    return checkResult(findings, "");
  }

  findings.push(...validateChangelog(parsed, config.packageVersion, file));

  return checkResult(findings, `${file} verified — ${parsed.versions.length} released versions, newest first, matching package.json.`);
}
