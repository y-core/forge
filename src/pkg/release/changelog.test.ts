import { describe, expect, it } from "bun:test";
import { formatReleaseDate, parseChangelog, promoteUnreleased } from "./changelog";

/** The em dash the grammar requires, as an escape. Written this way throughout so an en dash
 *  cannot pass a review by looking identical in a diff. */
const EM = "—";

/** A canonical document: prose preamble, `---` separators, a written `[Unreleased]` with a `###`
 *  subsection, two released versions, and a link definition block. Deliberately built with
 *  `join("\n")` so it carries **no trailing newline**, matching the real `CHANGELOG.md`. */
const DOC = [
  "# Changelog",
  "",
  "intro prose",
  "",
  "---",
  "",
  "## [Unreleased]",
  "",
  "### Added",
  "",
  "- a thing",
  "",
  "---",
  "",
  `## [0.0.2] ${EM} 2026-01-02`,
  "",
  "second body",
  "",
  "---",
  "",
  `## [0.0.1] ${EM} 2026-01-01`,
  "",
  "first body",
  "",
  "[0.0.2]: https://x/compare/v0.0.1...v0.0.2",
  "[0.0.1]: https://x/releases/tag/v0.0.1",
].join("\n");

describe("parseChangelog() — structure", () => {
  it("locates Unreleased, its body, and every released heading", () => {
    const parsed = parseChangelog(DOC);
    if (!parsed.ok) throw new Error(`expected ok, got: ${parsed.errors.join("; ")}`);
    expect(parsed.unreleased.line).toBe(6);
    expect(parsed.unreleased.body).toEqual(["", "### Added", "", "- a thing", "", "---", ""]);
    expect(parsed.versions).toEqual([
      { version: "0.0.2", date: "2026-01-02", line: 14 },
      { version: "0.0.1", date: "2026-01-01", line: 20 },
    ]);
    expect(parsed.linkRefs).toEqual(["0.0.2", "0.0.1"]);
  });

  it("ends the Unreleased body at the next `## ` heading, not at a `###` subsection", () => {
    const parsed = parseChangelog(DOC);
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.unreleased.body.includes("### Added")).toBe(true);
    expect(parsed.unreleased.empty).toBe(false);
  });
});

describe("parseChangelog() — emptiness", () => {
  function bodyOf(lines: string[]): boolean {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", ...lines, "", `## [0.0.1] ${EM} 2026-01-01`, "", "body"].join("\n"));
    if (!parsed.ok) throw new Error(`expected ok, got: ${parsed.errors.join("; ")}`);
    return parsed.unreleased.empty;
  }

  it("treats the `_Nothing yet._` placeholder as empty", () => {
    expect(bodyOf(["", "_Nothing yet._"])).toBe(true);
  });

  it("treats a whitespace-only body as empty", () => {
    expect(bodyOf(["", "   ", ""])).toBe(true);
  });

  it("treats a body of only `---` separators as empty", () => {
    expect(bodyOf(["", "---", ""])).toBe(true);
  });

  it("treats the placeholder alongside a separator as empty", () => {
    expect(bodyOf(["", "_Nothing yet._", "", "---"])).toBe(true);
  });

  it("treats one line of prose as not empty", () => {
    expect(bodyOf(["", "- fixed a thing"])).toBe(false);
  });

  it("treats a variant placeholder spelling as not empty", () => {
    expect(bodyOf(["", "_nothing yet._"])).toBe(false);
  });

  it("treats a `###` subsection with no items as not empty", () => {
    expect(bodyOf(["", "### Added"])).toBe(false);
  });
});

describe("parseChangelog() — refusals", () => {
  it("refuses a document with no `[Unreleased]` section", () => {
    const parsed = parseChangelog(["# Changelog", "", `## [0.0.1] ${EM} 2026-01-01`].join("\n"));
    expect(parsed).toEqual({ ok: false, errors: ["no `## [Unreleased]` section — it is the only section humans edit, and release promotes it"] });
  });

  it("refuses two `[Unreleased]` headings", () => {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", "", "## [Unreleased]"].join("\n"));
    expect(parsed).toEqual({ ok: false, errors: ["2 `## [Unreleased]` headings (lines 3, 5) — there must be exactly one"] });
  });

  it("refuses an entry heading above `[Unreleased]`", () => {
    const parsed = parseChangelog(["# Changelog", "", `## [0.0.1] ${EM} 2026-01-01`, "", "## [Unreleased]"].join("\n"));
    expect(parsed).toEqual({ ok: false, errors: ["line 3: an entry heading precedes `## [Unreleased]` (line 5) — Unreleased must be first"] });
  });

  it("refuses an en dash in place of the em dash", () => {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", "", "## [0.0.1] – 2026-01-01"].join("\n"));
    expect(parsed).toEqual({
      ok: false,
      errors: ["line 5: `## [0.0.1] – 2026-01-01` does not match `## [X.Y.Z] — YYYY-MM-DD` (the separator is an em dash)"],
    });
  });

  it("refuses a hyphen in place of the em dash", () => {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", "", "## [0.0.1] - 2026-01-01"].join("\n"));
    expect(parsed).toEqual({
      ok: false,
      errors: ["line 5: `## [0.0.1] - 2026-01-01` does not match `## [X.Y.Z] — YYYY-MM-DD` (the separator is an em dash)"],
    });
  });

  it("refuses an unpadded date", () => {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", "", `## [0.0.1] ${EM} 2026-1-1`].join("\n"));
    expect(parsed).toEqual({
      ok: false,
      errors: [`line 5: \`## [0.0.1] ${EM} 2026-1-1\` does not match \`## [X.Y.Z] ${EM} YYYY-MM-DD\` (the separator is an em dash)`],
    });
  });

  it("refuses a trailing space after the date", () => {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", "", `## [0.0.1] ${EM} 2026-01-01 `].join("\n"));
    expect(parsed).toEqual({
      ok: false,
      errors: [`line 5: \`## [0.0.1] ${EM} 2026-01-01 \` does not match \`## [X.Y.Z] ${EM} YYYY-MM-DD\` (the separator is an em dash)`],
    });
  });

  it("refuses a well-shaped date that is not a real calendar day", () => {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", "", `## [0.0.1] ${EM} 2026-02-31`].join("\n"));
    expect(parsed).toEqual({ ok: false, errors: ["line 5: `2026-02-31` is not a real calendar date"] });
  });

  it("reports every malformed heading in one pass, not just the first", () => {
    const parsed = parseChangelog(
      ["# Changelog", "", "## [Unreleased]", "", "## [0.0.2] - 2026-01-02", "", `## [0.0.1] ${EM} 2026-02-31`].join("\n"),
    );
    if (parsed.ok) throw new Error("expected failure");
    expect(parsed.errors).toHaveLength(2);
  });
});

describe("promoteUnreleased()", () => {
  const EXPECTED = [
    "# Changelog",
    "",
    "intro prose",
    "",
    "---",
    "",
    "## [Unreleased]",
    "",
    "_Nothing yet._",
    "",
    "---",
    "",
    `## [0.0.3] ${EM} 2026-02-03`,
    "",
    "### Added",
    "",
    "- a thing",
    "",
    "---",
    "",
    `## [0.0.2] ${EM} 2026-01-02`,
    "",
    "second body",
    "",
    "---",
    "",
    `## [0.0.1] ${EM} 2026-01-01`,
    "",
    "first body",
    "",
    "[0.0.3]: https://x/compare/v0.0.2...v0.0.3",
    "[0.0.2]: https://x/compare/v0.0.1...v0.0.2",
    "[0.0.1]: https://x/releases/tag/v0.0.1",
  ].join("\n");

  it("promotes the whole document exactly", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error(`expected ok, got: ${result.errors.join("; ")}`);
    expect(result.source).toBe(EXPECTED);
  });

  it("round-trips a source with no trailing newline without adding one", () => {
    expect(DOC.endsWith("\n")).toBe(false);
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.source.endsWith("\n")).toBe(false);
  });

  it("writes the heading separator as an em dash, not an en dash", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.source.split("\n")[12]).toBe(`## [0.0.3] — 2026-02-03`);
  });

  it("neither moves nor duplicates the `---` above the section", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03" });
    if (!result.ok) throw new Error("expected ok");
    const lines = result.source.split("\n");
    expect(lines[4]).toBe("---");
    expect(lines.filter((line) => line === "---")).toHaveLength(4);
  });

  it("inserts the link definition above the existing block, unshifted by the six lines added at the top", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error("expected ok");
    const lines = result.source.split("\n");
    expect(lines.indexOf("[0.0.3]: https://x/compare/v0.0.2...v0.0.3")).toBe(30);
    expect(lines[31]).toBe("[0.0.2]: https://x/compare/v0.0.1...v0.0.2");
  });

  it("honours a non-default tag prefix in the compare URL", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03", tagPrefix: "pkg-v", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.source.split("\n")[30]).toBe("[0.0.3]: https://x/compare/pkg-v0.0.2...pkg-v0.0.3");
  });

  it("omits the link definition when no compare URL base is supplied", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.source.includes("[0.0.3]:")).toBe(false);
  });

  it("omits the link definition on a first release, where there is nothing to compare against", () => {
    const source = ["# Changelog", "", "## [Unreleased]", "", "- a thing"].join("\n");
    const result = promoteUnreleased(source, { version: "0.0.1", date: "2026-02-03", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.source).toBe(
      ["# Changelog", "", "## [Unreleased]", "", "_Nothing yet._", "", "---", "", `## [0.0.1] ${EM} 2026-02-03`, "", "- a thing"].join("\n"),
    );
  });

  it("appends a definition block after a blank line when the document has none", () => {
    const source = ["# Changelog", "", "## [Unreleased]", "", "- a thing", "", `## [0.0.1] ${EM} 2026-01-01`, "", "first body"].join("\n");
    const result = promoteUnreleased(source, { version: "0.0.2", date: "2026-02-03", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error("expected ok");
    const lines = result.source.split("\n");
    expect(lines[lines.length - 2]).toBe("");
    expect(lines[lines.length - 1]).toBe("[0.0.2]: https://x/compare/v0.0.1...v0.0.2");
  });

  it("promotes an empty section verbatim, carrying the placeholder into the released body", () => {
    const source = ["# Changelog", "", "## [Unreleased]", "", "_Nothing yet._"].join("\n");
    const result = promoteUnreleased(source, { version: "0.0.1", date: "2026-02-03" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.source).toBe(
      ["# Changelog", "", "## [Unreleased]", "", "_Nothing yet._", "", "---", "", `## [0.0.1] ${EM} 2026-02-03`, "", "_Nothing yet._"].join("\n"),
    );
  });

  it("propagates a parse failure rather than promoting a malformed document", () => {
    const result = promoteUnreleased(["# Changelog", "", "## [0.0.1] - 2026-01-01"].join("\n"), { version: "0.0.2", date: "2026-02-03" });
    expect(result.ok).toBe(false);
  });

  it("a promoted document parses, with the new Unreleased empty and the version on top", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error("expected ok");
    const parsed = parseChangelog(result.source);
    if (!parsed.ok) throw new Error(`promoted document does not parse: ${parsed.errors.join("; ")}`);
    expect(parsed.unreleased.empty).toBe(true);
    expect(parsed.versions[0]).toEqual({ version: "0.0.3", date: "2026-02-03", line: 12 });
  });
});

describe("formatReleaseDate()", () => {
  it("formats a local-calendar date as YYYY-MM-DD", () => {
    expect(formatReleaseDate(new Date(2026, 0, 1))).toBe("2026-01-01");
  });

  it("zero-pads both month and day", () => {
    expect(formatReleaseDate(new Date(2026, 8, 5))).toBe("2026-09-05");
  });

  it("reads the local calendar day, not UTC — a late-evening release stamps today", () => {
    // 23:30 local on the 31st. `toISOString().slice(0, 10)` would stamp the 1st of the next
    // month in any positive-offset zone; the local reading stamps the releaser's day everywhere.
    expect(formatReleaseDate(new Date(2026, 11, 31, 23, 30))).toBe("2026-12-31");
  });
});
