import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { ChangelogDocument, VersionHeading } from "../../../src/tooling/gate/types";
import { checkChangelog, validateChangelog } from "./changelog";

const VALID = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "_Nothing yet._",
  "",
  "---",
  "",
  "## [1.2.0] — 2026-02-01",
  "",
  "Bodies are prose.",
  "",
  "---",
  "",
  "## [1.1.0] — 2026-01-01",
  "",
  "Bodies are prose.",
  "",
  "[1.2.0]: https://example.test/compare/v1.1.0...v1.2.0",
  "[1.1.0]: https://example.test/releases/v1.1.0",
  "",
].join("\n");

/** A throwaway root carrying `source` as its changelog, or no changelog when `source` is undefined. */
function root(source?: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), "forge-changelog-check-"));
  if (source !== undefined) writeFileSync(resolve(dir, "CHANGELOG.md"), source, "utf-8");
  return dir;
}

function messages(source: string | undefined, packageVersion = "1.2.0"): string[] {
  return checkChangelog({ root: root(source), packageVersion }).findings.map((finding) => finding.message);
}

/** A document with only the fields `validateChangelog` reads; the unreleased section is inert here. */
function document(versions: VersionHeading[], linkRefs: string[]): ChangelogDocument {
  return { unreleased: { line: 2, body: [], empty: true }, versions, linkRefs };
}

function validate(versions: VersionHeading[], linkRefs: string[], packageVersion: string): string[] {
  return validateChangelog(document(versions, linkRefs), packageVersion, "CHANGELOG.md").map((finding) => finding.message);
}

describe("validateChangelog() — heading order", () => {
  it("accepts headings running newest first, dated newest first, matching package.json", () => {
    const versions = [
      { version: "1.2.0", date: "2026-02-01", line: 8 },
      { version: "1.1.0", date: "2026-01-01", line: 14 },
    ];

    expect(validate(versions, ["1.2.0", "1.1.0"], "1.2.0")).toEqual([]);
  });

  it("reports a version repeated lower down, naming the line it was first seen on", () => {
    const versions = [
      { version: "1.0.0", date: "2026-01-01", line: 5 },
      { version: "1.0.0", date: "2026-01-01", line: 9 },
    ];

    expect(validate(versions, ["1.0.0"], "1.0.0")).toEqual([
      "duplicate version `1.0.0` (first seen at line 6)",
      "`1.0.0` is not below `1.0.0` — versions run newest first",
    ]);
  });

  it("reports a lower heading carrying the higher version", () => {
    const versions = [
      { version: "1.0.0", date: "2026-02-01", line: 5 },
      { version: "2.0.0", date: "2026-01-01", line: 9 },
    ];

    expect(validate(versions, ["1.0.0", "2.0.0"], "1.0.0")).toEqual(["`2.0.0` is not below `1.0.0` — versions run newest first"]);
  });

  it("reports a lower heading dated after the one above it", () => {
    const versions = [
      { version: "2.0.0", date: "2026-01-01", line: 5 },
      { version: "1.0.0", date: "2026-02-01", line: 9 },
    ];

    expect(validate(versions, ["2.0.0", "1.0.0"], "2.0.0")).toEqual(["`1.0.0` is dated 2026-02-01, after `2.0.0` (2026-01-01) above it"]);
  });
});

describe("validateChangelog() — the package.json invariant", () => {
  it("reports a topmost heading that does not equal the packaged version", () => {
    const versions = [{ version: "1.0.0", date: "2026-01-01", line: 5 }];

    expect(validate(versions, ["1.0.0"], "2.0.0")).toEqual([
      "topmost released version `1.0.0` does not equal package.json's `2.0.0` — a released heading was hand-written, or a release was not completed. Move the body under `## [Unreleased]` and let the release command promote it.",
    ]);
  });

  it("warns rather than fails when there is no released heading to hold the packaged version against", () => {
    const findings = validateChangelog(document([], []), "1.0.0", "CHANGELOG.md");

    expect(findings).toEqual([
      { level: "warn", message: "no released version headings yet — the version-equality invariant cannot be checked", file: "CHANGELOG.md" },
    ]);
  });
});

describe("validateChangelog() — link reference definitions", () => {
  it("reports a definition naming a version no heading declares", () => {
    const versions = [{ version: "1.0.0", date: "2026-01-01", line: 5 }];

    expect(validate(versions, ["1.0.0", "9.9.9"], "1.0.0")).toEqual(["link definition `[9.9.9]` names a version with no heading"]);
  });

  it("warns about a heading with no definition, which renders as literal text", () => {
    const versions = [{ version: "1.0.0", date: "2026-01-01", line: 5 }];

    expect(validate(versions, [], "1.0.0")).toEqual(["`[1.0.0]` has no link reference definition — it renders as literal text"]);
  });
});

describe("checkChangelog()", () => {
  it("passes a well-formed changelog and names what it covered", () => {
    const result = checkChangelog({ root: root(VALID), packageVersion: "1.2.0" });

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("CHANGELOG.md verified — 2 released versions, newest first, matching package.json.");
  });

  it("reports a missing file rather than passing over one it never read", () => {
    const result = checkChangelog({ root: root(), packageVersion: "1.2.0" });

    expect(result.findings).toEqual([{ level: "fail", message: "file does not exist", file: "CHANGELOG.md" }]);
    expect(result.summary).toBe("");
  });

  it("reports a wrong first line", () => {
    expect(messages(VALID.replace("# Changelog", "# Release notes"))).toEqual(["first line is not `# Changelog`"]);
  });

  it("surfaces every parse error and stops, rather than judging a document it could not read", () => {
    const result = checkChangelog({ root: root(VALID.replace("## [Unreleased]", "## [Not a version]")), packageVersion: "1.2.0" });

    expect(result.findings.map((finding) => finding.message)).toEqual([
      "line 3: `## [Not a version]` does not match `## [X.Y.Z] — YYYY-MM-DD` (the separator is an em dash)",
      "no `## [Unreleased]` section — it is the only section humans edit, and release promotes it",
    ]);
    expect(result.summary).toBe("");
  });

  it("blames the file and line of the version-equality failure", () => {
    const result = checkChangelog({ root: root(VALID), packageVersion: "9.9.9" });

    expect(result.findings.map((finding) => ({ file: finding.file, line: finding.line }))).toEqual([{ file: "CHANGELOG.md", line: 9 }]);
  });

  it("reads the configured file and title instead of the defaults", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "forge-changelog-check-"));
    writeFileSync(resolve(dir, "HISTORY.md"), VALID.replace("# Changelog", "# History"), "utf-8");

    const result = checkChangelog({ root: dir, packageVersion: "1.2.0", file: "HISTORY.md", title: "# History" });

    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("HISTORY.md verified — 2 released versions, newest first, matching package.json.");
  });

  it("passes a changelog with no released heading at all — the empty document is warned about, never refused", () => {
    const result = checkChangelog({ root: root("# Changelog\n\n## [Unreleased]\n\n_Nothing yet._\n"), packageVersion: "1.0.0" });

    expect(result.ok).toBe(true);
    expect(result.findings.map((finding) => finding.level)).toEqual(["warn"]);
    expect(result.summary).toBe("CHANGELOG.md verified — 0 released versions, newest first, matching package.json.");
  });
});
