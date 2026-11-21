import { describe, expect, it } from "bun:test";

import { formatReleaseDate, parseChangelog, promoteUnreleased, reopenRelease } from "./changelog";

/** The em dash the grammar requires, escaped so an en dash cannot pass unnoticed in a diff. */
const EM = "—";

/** A canonical document, deliberately carrying no trailing newline like the real `CHANGELOG.md`. */
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
    if (!parsed.ok) throw new Error(`expected ok, got: ${parsed.error.join("; ")}`);
    expect(parsed.data.unreleased.line).toBe(6);
    expect(parsed.data.unreleased.body).toEqual(["", "### Added", "", "- a thing", "", "---", ""]);
    // The body is what the section digest is taken over, so the rule between sections and the link
    // definitions below the last one are stripped: neither is prose a release wrote.
    expect(parsed.data.versions).toEqual([
      { version: "0.0.2", date: "2026-01-02", line: 14, body: ["", "second body"] },
      { version: "0.0.1", date: "2026-01-01", line: 20, body: ["", "first body"] },
    ]);
    expect(parsed.data.linkRefs).toEqual(["0.0.2", "0.0.1"]);
  });

  it("ends the Unreleased body at the next `## ` heading, not at a `###` subsection", () => {
    const parsed = parseChangelog(DOC);
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.data.unreleased.body.includes("### Added")).toBe(true);
    expect(parsed.data.unreleased.empty).toBe(false);
  });
});

describe("parseChangelog() — emptiness", () => {
  function bodyOf(lines: string[]): boolean {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", ...lines, "", `## [0.0.1] ${EM} 2026-01-01`, "", "body"].join("\n"));
    if (!parsed.ok) throw new Error(`expected ok, got: ${parsed.error.join("; ")}`);
    return parsed.data.unreleased.empty;
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
    expect(parsed).toEqual({ ok: false, error: ["no `## [Unreleased]` section — it is the only section humans edit, and release promotes it"] });
  });

  it("refuses two `[Unreleased]` headings", () => {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", "", "## [Unreleased]"].join("\n"));
    expect(parsed).toEqual({ ok: false, error: ["2 `## [Unreleased]` headings (lines 3, 5) — there must be exactly one"] });
  });

  it("refuses an entry heading above `[Unreleased]`", () => {
    const parsed = parseChangelog(["# Changelog", "", `## [0.0.1] ${EM} 2026-01-01`, "", "## [Unreleased]"].join("\n"));
    expect(parsed).toEqual({ ok: false, error: ["line 3: an entry heading precedes `## [Unreleased]` (line 5) — Unreleased must be first"] });
  });

  it("refuses an en dash in place of the em dash", () => {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", "", "## [0.0.1] – 2026-01-01"].join("\n"));
    expect(parsed).toEqual({
      ok: false,
      error: ["line 5: `## [0.0.1] – 2026-01-01` does not match `## [X.Y.Z] — YYYY-MM-DD` (the separator is an em dash)"],
    });
  });

  it("refuses a hyphen in place of the em dash", () => {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", "", "## [0.0.1] - 2026-01-01"].join("\n"));
    expect(parsed).toEqual({
      ok: false,
      error: ["line 5: `## [0.0.1] - 2026-01-01` does not match `## [X.Y.Z] — YYYY-MM-DD` (the separator is an em dash)"],
    });
  });

  it("refuses an unpadded date", () => {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", "", `## [0.0.1] ${EM} 2026-1-1`].join("\n"));
    expect(parsed).toEqual({
      ok: false,
      error: [`line 5: \`## [0.0.1] ${EM} 2026-1-1\` does not match \`## [X.Y.Z] ${EM} YYYY-MM-DD\` (the separator is an em dash)`],
    });
  });

  it("refuses a trailing space after the date", () => {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", "", `## [0.0.1] ${EM} 2026-01-01 `].join("\n"));
    expect(parsed).toEqual({
      ok: false,
      error: [`line 5: \`## [0.0.1] ${EM} 2026-01-01 \` does not match \`## [X.Y.Z] ${EM} YYYY-MM-DD\` (the separator is an em dash)`],
    });
  });

  it("refuses a well-shaped date that is not a real calendar day", () => {
    const parsed = parseChangelog(["# Changelog", "", "## [Unreleased]", "", `## [0.0.1] ${EM} 2026-02-31`].join("\n"));
    expect(parsed).toEqual({ ok: false, error: ["line 5: `2026-02-31` is not a real calendar date"] });
  });

  it("reports every malformed heading in one pass, not just the first", () => {
    const parsed = parseChangelog(
      ["# Changelog", "", "## [Unreleased]", "", "## [0.0.2] - 2026-01-02", "", `## [0.0.1] ${EM} 2026-02-31`].join("\n"),
    );
    if (parsed.ok) throw new Error("expected failure");
    expect(parsed.error).toHaveLength(2);
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
    if (!result.ok) throw new Error(`expected ok, got: ${result.error.join("; ")}`);
    expect(result.data).toBe(EXPECTED);
  });

  it("round-trips a source with no trailing newline without adding one", () => {
    expect(DOC.endsWith("\n")).toBe(false);
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.endsWith("\n")).toBe(false);
  });

  it("writes the heading separator as an em dash, not an en dash", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.split("\n")[12]).toBe(`## [0.0.3] — 2026-02-03`);
  });

  it("neither moves nor duplicates the `---` above the section", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03" });
    if (!result.ok) throw new Error("expected ok");
    const lines = result.data.split("\n");
    expect(lines[4]).toBe("---");
    expect(lines.filter((line) => line === "---")).toHaveLength(4);
  });

  it("inserts the link definition above the existing block, unshifted by the six lines added at the top", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error("expected ok");
    const lines = result.data.split("\n");
    expect(lines.indexOf("[0.0.3]: https://x/compare/v0.0.2...v0.0.3")).toBe(30);
    expect(lines[31]).toBe("[0.0.2]: https://x/compare/v0.0.1...v0.0.2");
  });

  it("honours a non-default tag prefix in the compare URL", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03", tagPrefix: "pkg-v", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.split("\n")[30]).toBe("[0.0.3]: https://x/compare/pkg-v0.0.2...pkg-v0.0.3");
  });

  it("omits the link definition when no compare URL base is supplied", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.includes("[0.0.3]:")).toBe(false);
  });

  it("omits the link definition on a first release, where there is nothing to compare against", () => {
    const source = ["# Changelog", "", "## [Unreleased]", "", "- a thing"].join("\n");
    const result = promoteUnreleased(source, { version: "0.0.1", date: "2026-02-03", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toBe(
      ["# Changelog", "", "## [Unreleased]", "", "_Nothing yet._", "", "---", "", `## [0.0.1] ${EM} 2026-02-03`, "", "- a thing"].join("\n"),
    );
  });

  it("appends a definition block after a blank line when the document has none", () => {
    const source = ["# Changelog", "", "## [Unreleased]", "", "- a thing", "", `## [0.0.1] ${EM} 2026-01-01`, "", "first body"].join("\n");
    const result = promoteUnreleased(source, { version: "0.0.2", date: "2026-02-03", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error("expected ok");
    const lines = result.data.split("\n");
    expect(lines[lines.length - 2]).toBe("");
    expect(lines[lines.length - 1]).toBe("[0.0.2]: https://x/compare/v0.0.1...v0.0.2");
  });

  it("promotes an empty section verbatim, carrying the placeholder into the released body", () => {
    const source = ["# Changelog", "", "## [Unreleased]", "", "_Nothing yet._"].join("\n");
    const result = promoteUnreleased(source, { version: "0.0.1", date: "2026-02-03" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toBe(
      ["# Changelog", "", "## [Unreleased]", "", "_Nothing yet._", "", "---", "", `## [0.0.1] ${EM} 2026-02-03`, "", "_Nothing yet._"].join("\n"),
    );
  });

  it("propagates a parse failure rather than promoting a malformed document", () => {
    const result = promoteUnreleased(["# Changelog", "", "## [0.0.1] - 2026-01-01"].join("\n"), { version: "0.0.2", date: "2026-02-03" });
    expect(result.ok).toBe(false);
  });

  it("refuses a version that already has a heading, so a second run cannot promote it twice", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.2", date: "2026-02-03" });
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toEqual(["[0.0.2] is already a heading — the release was promoted once, and promoting it again would duplicate it"]);
  });

  it("a promoted document parses, with the new Unreleased empty and the version on top", () => {
    const result = promoteUnreleased(DOC, { version: "0.0.3", date: "2026-02-03", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error("expected ok");
    const parsed = parseChangelog(result.data);
    if (!parsed.ok) throw new Error(`promoted document does not parse: ${parsed.error.join("; ")}`);
    expect(parsed.data.unreleased.empty).toBe(true);
    expect(parsed.data.versions[0]).toEqual({ version: "0.0.3", date: "2026-02-03", line: 12, body: ["", "### Added", "", "- a thing"] });
  });
});

describe("reopenRelease()", () => {
  function promoted(source: string, version: string): string {
    const result = promoteUnreleased(source, { version, date: "2026-02-03", compareUrlBase: "https://x" });
    if (!result.ok) throw new Error(`expected ok, got: ${result.error.join("; ")}`);
    return result.data;
  }

  function reopened(source: string, version: string): string {
    const result = reopenRelease(source, version);
    if (!result.ok) throw new Error(`expected ok, got: ${result.error.join("; ")}`);
    return result.data;
  }

  it("is the exact inverse of promoteUnreleased when [Unreleased] holds only the placeholder", () => {
    const sources = [
      DOC,
      `${DOC}\n`,
      ["# Changelog", "", "## [Unreleased]", "", "- a thing"].join("\n"),
      ["# Changelog", "", "## [Unreleased]", "", "- a thing", "", `## [0.0.1] ${EM} 2026-01-01`, "", "first body", ""].join("\n"),
    ];
    for (const source of sources) expect(reopened(promoted(source, "0.0.3"), "0.0.3")).toBe(source);
  });

  it("merges an [Unreleased] entry into the matching subsection of the release, after its own entries", () => {
    const source = promoted(DOC, "0.0.3").replace("## [Unreleased]\n\n_Nothing yet._", "## [Unreleased]\n\n### Added\n\n- a later thing");
    expect(reopened(source, "0.0.3")).toBe(DOC.replace("- a thing", "- a thing\n- a later thing"));
  });

  it("appends a subsection the release did not have, keeping the ones it had in place", () => {
    const source = promoted(DOC, "0.0.3").replace("## [Unreleased]\n\n_Nothing yet._", "## [Unreleased]\n\n### Fixed\n\n- a fix");
    expect(reopened(source, "0.0.3")).toBe(DOC.replace("- a thing", "- a thing\n\n### Fixed\n\n- a fix"));
  });

  it("keeps prose that comes before any subsection ahead of the subsections", () => {
    const source = promoted(DOC, "0.0.3").replace("## [Unreleased]\n\n_Nothing yet._", "## [Unreleased]\n\nA summary paragraph.");
    expect(reopened(source, "0.0.3")).toBe(DOC.replace("## [Unreleased]\n\n### Added", "## [Unreleased]\n\nA summary paragraph.\n\n### Added"));
  });

  it("returns a document with no [version] section unchanged", () => {
    expect(reopened(DOC, "0.0.3")).toBe(DOC);
  });

  it("refuses to reopen a section that is not the newest release", () => {
    expect(reopenRelease(DOC, "0.0.1").ok).toBe(false);
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
    // 23:30 local on the 31st: `toISOString()` would stamp the next month in a positive-offset zone.
    expect(formatReleaseDate(new Date(2026, 11, 31, 23, 30))).toBe("2026-12-31");
  });
});

describe("reopenRelease() — properties over every pairing of body shapes", () => {
  function shapes(who: string): Record<string, string[]> {
    return {
      bullet: [`- ${who} item`],
      added: ["### Added", "", `- ${who} added`],
      fixed: ["### Fixed", "", `- ${who} fixed`],
      prose: [`${who} summary prose.`],
      both: ["### Added", "", `- ${who} added two`, "", "### Fixed", "", `- ${who} fixed two`],
    };
  }

  function document(released: readonly string[], unreleased: readonly string[] | null): string {
    return [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      ...(unreleased ?? ["_Nothing yet._"]),
      "",
      "---",
      "",
      `## [0.0.3] ${EM} 2026-02-03`,
      "",
      ...released,
      "",
      "---",
      "",
      `## [0.0.2] ${EM} 2026-01-02`,
      "",
      "second body",
      "",
      "[0.0.3]: https://x/compare/v0.0.2...v0.0.3",
      "[0.0.2]: https://x/releases/tag/v0.0.2",
    ].join("\n");
  }

  function unwrap(result: ReturnType<typeof reopenRelease>): string {
    if (!result.ok) throw new Error(`expected ok, got: ${result.error.join("; ")}`);
    return result.data;
  }

  const recut = (source: string): string =>
    unwrap(promoteUnreleased(unwrap(reopenRelease(source, "0.0.3")), { version: "0.0.3", date: "2026-02-03", compareUrlBase: "https://x" }));

  /** The lines of the section headed `heading`, up to the next level-2 heading. */
  function sectionLines(source: string, heading: string): string[] {
    const lines = source.split("\n");
    const from = lines.findIndex((line) => line.startsWith(heading));
    const to = lines.findIndex((line, i) => i > from && line.startsWith("## "));
    return lines.slice(from + 1, to === -1 ? undefined : to);
  }

  function content(lines: readonly string[]): { entries: string[]; subsections: string[] } {
    const meaningful = lines.filter((line) => line.trim() !== "" && line.trim() !== "---" && line !== "_Nothing yet._" && !/^\[\d/.test(line));
    return {
      entries: meaningful.filter((line) => !line.startsWith("### ")).sort(),
      subsections: [...new Set(meaningful.filter((line) => line.startsWith("### ")))].sort(),
    };
  }

  const pairs: { name: string; released: string[]; unreleased: string[] | null }[] = [];
  for (const [rName, released] of Object.entries(shapes("v"))) {
    pairs.push({ name: `${rName} with nothing pending`, released, unreleased: null });
    for (const [uName, unreleased] of Object.entries(shapes("u"))) pairs.push({ name: `${rName} with ${uName} pending`, released, unreleased });
  }

  for (const { name, released, unreleased } of pairs) {
    it(`${name}: re-cutting is idempotent, loses no line from either body, and leaves one [0.0.3] with one link`, () => {
      const source = document(released, unreleased);
      const once = recut(source);
      const expected = content([...released, ...(unreleased ?? [])]);

      expect({
        twice: recut(once),
        reopened: content(sectionLines(unwrap(reopenRelease(source, "0.0.3")), "## [Unreleased]")),
        released: content(sectionLines(once, "## [0.0.3]")),
        headings: once.split("\n").filter((line) => line.startsWith("## [0.0.3]")).length,
        links: once.split("\n").filter((line) => line.startsWith("[0.0.3]: ")).length,
        pureResumeReproduces: unreleased === null ? once === source : true,
      }).toEqual({ twice: once, reopened: expected, released: expected, headings: 1, links: 1, pureResumeReproduces: true });
    });
  }
});
