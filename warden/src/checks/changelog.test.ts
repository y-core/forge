import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { changelogSectionDigest, parseChangelog, promoteUnreleased } from "../../../src/tooling/gate/changelog";
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
      { version: "1.2.0", date: "2026-02-01", line: 8, body: [] },
      { version: "1.1.0", date: "2026-01-01", line: 14, body: [] },
    ];

    expect(validate(versions, ["1.2.0", "1.1.0"], "1.2.0")).toEqual([]);
  });

  it("reports a version repeated lower down, naming the line it was first seen on", () => {
    const versions = [
      { version: "1.0.0", date: "2026-01-01", line: 5, body: [] },
      { version: "1.0.0", date: "2026-01-01", line: 9, body: [] },
    ];

    expect(validate(versions, ["1.0.0"], "1.0.0")).toEqual([
      "duplicate version `1.0.0` (first seen at line 6)",
      "`1.0.0` is not below `1.0.0` — versions run newest first",
    ]);
  });

  it("reports a lower heading carrying the higher version", () => {
    const versions = [
      { version: "1.0.0", date: "2026-02-01", line: 5, body: [] },
      { version: "2.0.0", date: "2026-01-01", line: 9, body: [] },
    ];

    expect(validate(versions, ["1.0.0", "2.0.0"], "1.0.0")).toEqual(["`2.0.0` is not below `1.0.0` — versions run newest first"]);
  });

  it("reports a lower heading dated after the one above it", () => {
    const versions = [
      { version: "2.0.0", date: "2026-01-01", line: 5, body: [] },
      { version: "1.0.0", date: "2026-02-01", line: 9, body: [] },
    ];

    expect(validate(versions, ["2.0.0", "1.0.0"], "2.0.0")).toEqual(["`1.0.0` is dated 2026-02-01, after `2.0.0` (2026-01-01) above it"]);
  });
});

describe("validateChangelog() — the package.json invariant", () => {
  it("reports a topmost heading that does not equal the packaged version", () => {
    const versions = [{ version: "1.0.0", date: "2026-01-01", line: 5, body: [] }];

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
    const versions = [{ version: "1.0.0", date: "2026-01-01", line: 5, body: [] }];

    expect(validate(versions, ["1.0.0", "9.9.9"], "1.0.0")).toEqual(["link definition `[9.9.9]` names a version with no heading"]);
  });

  it("warns about a heading with no definition, which renders as literal text", () => {
    const versions = [{ version: "1.0.0", date: "2026-01-01", line: 5, body: [] }];

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

// The defect this closes: a whole engine was documented under a released heading and the gate
// stayed green, because nothing here had ever read a released section's body.
describe("a released section is not a place to write", () => {
  /** A root carrying `source`, with a manifest recorded from `released` — what a release wrote. */
  function rootWith(source: string, record: (doc: ChangelogDocument) => Record<string, string>, released = source): string {
    const dir = root(source);
    const parsed = parseChangelog(released);
    if (!parsed.ok) throw new Error(parsed.error.join("\n"));
    mkdirSync(resolve(dir, "config"), { recursive: true });
    writeFileSync(resolve(dir, "config/changelog-sections.json"), JSON.stringify(record(parsed.data)), "utf-8");
    return dir;
  }

  /** The manifest a release of `source` would have written. */
  const recorded = (doc: ChangelogDocument): Record<string, string> =>
    Object.fromEntries(doc.versions.map((heading) => [heading.version, changelogSectionDigest(heading.body)]));

  function findingsFor(source: string, packageVersion = "1.2.0", released = source): string[] {
    return checkChangelog({ root: rootWith(source, recorded, released), packageVersion }).findings.map((finding) => finding.message);
  }

  it("passes a document whose sections are exactly what was released", () => {
    expect(findingsFor(VALID)).toEqual([]);
  });

  it("refuses a line added under a dated heading", () => {
    const edited = VALID.replace("## [1.2.0] — 2026-02-01\n\nBodies are prose.", "## [1.2.0] — 2026-02-01\n\nBodies are prose.\n\n- Snuck in.");
    expect(findingsFor(edited, "1.2.0", VALID).join()).toContain("`1.2.0`'s section has been edited since it was released");
  });

  it("passes the same line written under `[Unreleased]`, which is the section to write in", () => {
    expect(findingsFor(VALID.replace("_Nothing yet._", "- Snuck in."), "1.2.0", VALID)).toEqual([]);
  });

  // A section a release never recorded is one a hand wrote — the shape `bug-260920-54` took.
  it("refuses a dated heading the release command never recorded", () => {
    const dir = rootWith(VALID, (doc) => {
      const all = recorded(doc);
      delete all["1.2.0"];
      return all;
    });
    expect(
      checkChangelog({ root: dir, packageVersion: "1.2.0" })
        .findings.map((f) => f.message)
        .join(),
    ).toContain("`1.2.0` has no recorded section digest");
  });

  it("refuses a digest recorded for a version the changelog no longer carries", () => {
    const dir = rootWith(VALID, (doc) => ({ ...recorded(doc), "9.9.9": "0000000000000000" }));
    expect(
      checkChangelog({ root: dir, packageVersion: "1.2.0" })
        .findings.map((f) => f.message)
        .join(),
    ).toContain("recorded for `9.9.9`, which the changelog no longer carries");
  });

  // The trap the task names: a check that fails every release is a check that gets bypassed.
  it("passes a `bun run release` promotion, with the manifest that release writes beside it", () => {
    const promoted = promoteUnreleased(VALID.replace("_Nothing yet._", "- A real entry."), {
      version: "1.3.0",
      date: "2026-03-01",
      compareUrlBase: "https://example.test",
    });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(findingsFor(promoted.data, "1.3.0")).toEqual([]);
  });

  // Neither is prose a release wrote, so neither may move a digest.
  it("ignores the rule between sections and the link definitions below them", () => {
    const parsed = parseChangelog(VALID);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.versions.map((heading) => heading.body)).toEqual([
      ["", "Bodies are prose."],
      ["", "Bodies are prose."],
    ]);
  });

  it("says nothing at all where the project keeps no manifest, so adopting it is a choice", () => {
    expect(messages(VALID)).toEqual([]);
  });
});
