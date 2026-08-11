/** validate-changelog.ts — the release-correctness gate for `CHANGELOG.md`.
 *
 *  Registered on `verify` only. The invariants are release-shaped: requiring a written
 *  `[Unreleased]` entry on every `bun run check` would fail every work-in-progress commit, while
 *  `verify` runs exactly where it matters — before `prepublishOnly` and before a tag exists.
 *
 *  House style follows `validate-docs.ts`: this file owns I/O and reporting, the grammar lives in
 *  a separate pure module. It is *not* a fourth `scripts/*-parse.ts`, though — `src/pkg/release.ts`
 *  needs the same parser to promote with, and two grammars for one document is exactly the drift
 *  this gate exists to catch. One parser, two callers.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };
import { compareSemVer, parseChangelog, parseSemVer } from "../src/pkg/mod";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "CHANGELOG.md";
const PKG_VERSION = (pkg as { version: string }).version;

// Run state, shared by the checks below rather than threaded through them. `main` is the only
// writer that resets it, so a second call starts from the same place a fresh process would.
let failures = 0;
let warnings: string[] = [];

function fail(message: string): void {
  console.error(`FAIL ${FILE}: ${message}`);
  failures++;
}

function warn(message: string): void {
  warnings.push(`WARN ${FILE}: ${message}`);
}

/** Runs every check and returns the exit code rather than exiting, so a test can import this
 *  module, call it, and read the verdict without the runner dying. */
export function main(): number {
  failures = 0;
  warnings = [];

  const path = resolve(ROOT, FILE);
  if (!existsSync(path)) {
    fail("file does not exist");
    console.error("\n1 problem found.");
    return 1;
  }
  const source = readFileSync(path, "utf-8");

  if (source.split("\n")[0] !== "# Changelog") {
    fail("first line is not `# Changelog`");
  } else {
    console.log("  ok title");
  }

  // ── Check 1: the grammar ────────────────────────────────────────────────────────────────────
  // Subsumes: exactly one `[Unreleased]`, it is the first entry heading, every other `## [`
  // heading matches `[X.Y.Z] — YYYY-MM-DD` with an em dash, and every date is a real calendar day.
  const parsed = parseChangelog(source);
  if (!parsed.ok) {
    for (const error of parsed.errors) fail(error);
    console.error(`\n${failures} problem${failures === 1 ? "" : "s"} found.`);
    return 1;
  }
  console.log(`  ok grammar (${parsed.versions.length} released versions)`);

  // ── Check 2: no duplicate versions ──────────────────────────────────────────────────────────
  const seen = new Map<string, number>();
  for (const heading of parsed.versions) {
    const first = seen.get(heading.version);
    if (first !== undefined) fail(`line ${heading.line + 1}: duplicate version \`${heading.version}\` (first seen at line ${first})`);
    else seen.set(heading.version, heading.line + 1);
  }

  // ── Check 3: versions strictly descending ───────────────────────────────────────────────────
  // Gaps are legitimate — `[0.0.73]` compares against `v0.0.68` because 0.0.69-0.0.72 never
  // shipped — so contiguity is deliberately not asserted. Only the ordering is.
  for (let i = 1; i < parsed.versions.length; i++) {
    const above = parsed.versions[i - 1];
    const below = parsed.versions[i];
    if (above === undefined || below === undefined) continue;
    const a = parseSemVer(above.version);
    const b = parseSemVer(below.version);
    if (a === null || b === null) continue; // the grammar already proved these parse
    if (compareSemVer(a, b) <= 0) {
      fail(`line ${below.line + 1}: \`${below.version}\` is not below \`${above.version}\` — versions run newest first`);
    }
  }

  // ── Check 4: dates non-increasing ───────────────────────────────────────────────────────────
  // Equal dates are allowed and occur: 0.0.79 and 0.0.78 both shipped on the same day. ISO dates
  // compare correctly as strings.
  for (let i = 1; i < parsed.versions.length; i++) {
    const above = parsed.versions[i - 1];
    const below = parsed.versions[i];
    if (above === undefined || below === undefined) continue;
    if (below.date > above.date) {
      fail(`line ${below.line + 1}: \`${below.version}\` is dated ${below.date}, after \`${above.version}\` (${above.date}) above it`);
    }
  }

  // ── Check 5: the drift detector ─────────────────────────────────────────────────────────────
  // The topmost *released* heading is the version that shipped, so it must equal the version
  // `package.json` carries. This is the invariant that catches a hand-written heading for a
  // version no tag exists for — the exact defect this gate was written for.
  const topmost = parsed.versions[0];
  if (topmost === undefined) {
    warn("no released version headings yet — the version-equality invariant cannot be checked");
  } else if (topmost.version !== PKG_VERSION) {
    fail(
      `line ${topmost.line + 1}: topmost released version \`${topmost.version}\` does not equal package.json's \`${PKG_VERSION}\` — ` +
        "a released heading was hand-written, or a release was not completed. Move the body under `## [Unreleased]` and let `bun run release` promote it.",
    );
  }

  // ── Check 6: link reference definitions ─────────────────────────────────────────────────────
  // FAIL in the direction that holds today: every definition must name a heading that exists.
  // The reverse — every heading has a definition — is a WARN, because promotion writes the
  // definition and older entries predate that.
  const headingVersions = new Set(parsed.versions.map((heading) => heading.version));
  for (const version of parsed.linkRefs) {
    if (!headingVersions.has(version)) fail(`link definition \`[${version}]\` names a version with no heading`);
  }
  const defined = new Set(parsed.linkRefs);
  for (const heading of parsed.versions) {
    if (!defined.has(heading.version)) warn(`\`[${heading.version}]\` has no link reference definition — it renders as literal text`);
  }

  for (const line of warnings) console.warn(line);

  if (failures > 0) {
    console.error(`\n${failures} problem${failures === 1 ? "" : "s"} found.`);
    return 1;
  }
  console.log(`\nChangelog verified (${parsed.versions.length} versions, ${warnings.length} warnings).`);
  return 0;
}

if (import.meta.main) process.exit(main());
