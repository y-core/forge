import { describe, expect, it } from "bun:test";

import { fail } from "../finding";
import { checkCommentBudget } from "./comment-budget";
import { gateFixtureRoot } from "./gate.fixture";

const fixtureRoot = (files: Record<string, string> = {}): string => gateFixtureRoot(files, "forge-comment-budget-");

const messages = (files: Record<string, string>, licences: ReadonlyMap<string, string> = new Map()): string[] =>
  checkCommentBudget({ root: fixtureRoot(files), sources: ["src"], licences }).findings.map((finding) => finding.message);

const LICENCE = "// Adapted from upstream (MIT, Copyright (c) upstream)\n// itself after another (ISC)\n// https://example.test/upstream\n";

describe("checkCommentBudget()", () => {
  it("passes a tree whose every comment is inside the budget", () => {
    expect(messages({ "src/a.ts": "/** Adds one. @public */\nexport const add = (n: number): number => n + 1;\n" })).toEqual([]);
  });

  it("reports a file's findings against that file, at the line the comment opens on", () => {
    const result = checkCommentBudget({
      root: fixtureRoot({ "src/ui/a.tsx": "const a = 1;\n/** One.\n *  Two. */\nexport default a;\n" }),
      sources: ["src"],
    });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => [finding.file, finding.line, finding.message])).toEqual([
      ["src/ui/a.tsx", 2, "TSDoc spans 2 lines — §5a permits one"],
    ]);
  });

  it("walks `.ts` and `.tsx` alike, and honours a `!`-prefixed exclusion", () => {
    const root = fixtureRoot({ "src/a.ts": "/** One.\n */\nexport const a = 1;\n", "src/vendor/b.tsx": "/** Two.\n */\nexport const b = 2;\n" });

    expect(checkCommentBudget({ root, sources: ["src", "!src/vendor"] }).findings.map((finding) => finding.file)).toEqual(["src/a.ts"]);
  });

  it("waives the leading run of a listed licence header", () => {
    expect(messages({ "src/a.ts": `${LICENCE}export const a = 1;\n` }, new Map([["src/a.ts", "upstream (MIT)"]]))).toEqual([]);
  });

  it("fails a listing that names no walked file — the list only shrinks", () => {
    expect(messages({ "src/a.ts": "export const a = 1;\n" }, new Map([["src/gone.ts", "upstream (MIT)"]]))).toEqual([
      "`src/gone.ts` is listed as carrying a licence notice but is not a file the check walks — delete the entry",
    ]);
  });

  it("fails a listing with no attribution, because the attribution is what the allowance buys", () => {
    expect(messages({ "src/a.ts": `${LICENCE}export const a = 1;\n` }, new Map([["src/a.ts", "  "]]))).toEqual([
      "`src/a.ts` is listed as carrying a licence notice with no attribution — name the upstream, or cut the header",
      "3 consecutive `//` lines — §5a form 3 caps an inline why at two",
    ]);
  });
});

describe("checkCommentBudget() — the vacuity refusal", () => {
  it("refuses a walk that matched no source, rather than reporting a green gate over nothing", () => {
    const result = checkCommentBudget({ root: fixtureRoot(), sources: ["src"] });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([fail("`src` matched no source — refusing to report a green comment-budget gate that scanned nothing")]);
    expect(result.summary).toBe("");
  });
});
