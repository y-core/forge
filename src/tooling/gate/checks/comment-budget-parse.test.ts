import { describe, expect, it } from "bun:test";

import { isToolingDirective, validateCommentBudget } from "./comment-budget-parse";
import { findComments } from "./source-scan";
import type { CommentSpan } from "./types";

const messages = (source: string, licensed = false): string[] =>
  validateCommentBudget("src/a.ts", source, licensed).map((finding) => finding.message);

const lines = (source: string): (number | undefined)[] => validateCommentBudget("src/a.ts", source).map((finding) => finding.line);

const only = (source: string): CommentSpan => findComments(source)[0] as CommentSpan;

describe("findComments() — the lexer, not a regex", () => {
  it("finds a one-line block and a `//` comment with their opening lines", () => {
    expect(findComments("/** one */\nconst a = 1; // two\n")).toEqual([
      { kind: "block", start: 0, end: 10, line: 1, text: "/** one */" },
      { kind: "line", start: 24, end: 30, line: 2, text: "// two" },
    ]);
  });

  it("opens no comment inside a string literal — the `/**` in a glob is data", () => {
    expect(findComments('const glob = "src/**/*.test.ts";\n')).toEqual([]);
  });

  it("opens no comment inside a template literal spanning lines", () => {
    expect(findComments("const header = `/** generated\\n *  do not edit\\n */`;\n")).toEqual([]);
  });

  it("opens no string inside a comment — an apostrophe in prose swallows nothing", () => {
    expect(findComments("// don't\nconst a = 1;\n").map((span) => span.text)).toEqual(["// don't"]);
  });

  // Adversarial fixture: the regex holds three backticks, so a lexer that does not read a regex
  // literal opens a template on the odd one and swallows every comment until the next backtick.
  it("opens no template literal on a backtick inside a regex", () => {
    const source = "const B = /`([^`]+)`/g;\n/** One.\n *  Two. */\nexport const a = 1;\n";

    expect(findComments(source).map((span) => span.line)).toEqual([2]);
  });

  it("still reads a `/` that divides as a `/`, so the comment after it is found", () => {
    expect(findComments("const ratio = width / height; // a note").map((span) => span.text)).toEqual(["// a note"]);
  });

  it("does not read a JSX closing tag as a regex, which would swallow the comment beside it", () => {
    expect(findComments("<p>don't</p> // a note").map((span) => span.text)).toEqual(["// a note"]);
  });

  it("carries the line an unterminated block opens on, rather than dropping it", () => {
    expect(only("const a = 1;\n/* never closed")).toEqual({ kind: "block", start: 13, end: 28, line: 2, text: "/* never closed" });
  });
});

describe("isToolingDirective() — outside the budget entirely", () => {
  it("is true of a lint suppression, in either comment spelling", () => {
    expect([only("// oxlint-disable-next-line no-explicit-any"), only("/* oxlint-disable */")].map(isToolingDirective)).toEqual([true, true]);
  });

  it("is true of a JSX pragma", () => {
    expect(isToolingDirective(only("/** @jsxImportSource @y-core/forge/jsx */"))).toBe(true);
  });

  it("is true of the `<marker>: <rule> — <reason>` form a check reads", () => {
    expect(isToolingDirective(only("/* modern-css-allow: forge-ui-platform-isolation — behind an ancestor on purpose */"))).toBe(true);
  });

  it("is false of a marker carrying no reason, which suppresses nothing either", () => {
    expect(isToolingDirective(only("/* modern-css-allow: forge-ui-platform-isolation */"))).toBe(false);
  });

  it("is true of a block holding a whole-line `--` marker, which needs three lines to exist at all", () => {
    expect(isToolingDirective(only("/*\n-- row-removal-authorised-by: feat-260101-01\n*/"))).toBe(true);
  });

  it("is true of a `--` marker block carrying more than one marker line", () => {
    expect(isToolingDirective(only("/*\n  -- row-removal-authorised-by: feat-1\n  -- reviewed-by: feat-2\n*/"))).toBe(true);
  });

  it("is false of a marker sharing its line with the delimiters, which no whole-line reader can parse", () => {
    expect(isToolingDirective(only("/* -- row-removal-authorised-by: feat-1 */"))).toBe(false);
  });

  it("is false of a marker sharing its line with the closing delimiter alone", () => {
    expect(isToolingDirective(only("/*\n-- row-removal-authorised-by: feat-1 */"))).toBe(false);
  });

  it("is false of a `--` marker block that also carries prose", () => {
    expect(isToolingDirective(only("/*\n-- row-removal-authorised-by: feat-1\nthe epic is gone by then\n*/"))).toBe(false);
  });

  it("is false of a TSDoc block, so `--` in documentation buys no exemption", () => {
    expect(isToolingDirective(only("/**\n-- row-removal-authorised-by: feat-1\n*/"))).toBe(false);
  });

  it("is true of every triple-slash directive TypeScript reads", () => {
    const directives = [
      '/// <reference path="./worker.d.ts" />',
      '/// <reference types="bun" />',
      '/// <reference lib="dom" />',
      '/// <amd-module name="worker" />',
      '/// <amd-dependency path="legacy" />',
    ];

    expect(directives.map((source) => isToolingDirective(only(source)))).toEqual([true, true, true, true, true]);
  });

  it("is false of a triple-slash XML doc tag, which is prose in directive clothing", () => {
    expect(isToolingDirective(only("/// <summary>"))).toBe(false);
  });

  it("is false of prose that merely opens with a word", () => {
    expect(isToolingDirective(only("// globally unique across every ledger"))).toBe(false);
  });
});

describe("validateCommentBudget() — §5a form 1, one line of TSDoc", () => {
  it("passes a block that closes on the line it opens on", () => {
    expect(messages('/** Renders a fragment. @public */\nexport function render(): string {\n  return "";\n}\n')).toEqual([]);
  });

  it("fails one that does not, and reports its opening line", () => {
    const source = "const a = 1;\n/** Renders a fragment.\n *  Twice, for two reasons.\n */\nexport function render(): void {}\n";

    expect(messages(source)).toEqual(["TSDoc spans 3 lines — §5a permits one"]);
    expect(lines(source)).toEqual([2]);
  });

  it("does not flag a `/**` block a string literal only looks like", () => {
    expect(messages('const header = "/**\\n *  generated\\n */";\n')).toEqual([]);
  });
});

describe("validateCommentBudget() — §5a form 2, the visibility tags alone", () => {
  it("passes `@public` and `@internal`", () => {
    expect(messages("/** One. @public */\n/** Two. @internal */\n")).toEqual([]);
  });

  it("fails `@example`, whose usage belongs in the unit's README", () => {
    expect(messages("/** Builds a config. @example `buildConfig()` @public */\n")).toEqual([
      "`@example` — §5a permits `@public` and `@internal` alone",
    ]);
  });

  it("fails `@param` and `@defaultValue`, which restate the signature", () => {
    expect(messages("/** One. @param one - the first @public */\n/** Two. @defaultValue `0` */\n")).toEqual([
      "`@param` — §5a permits `@public` and `@internal` alone",
      "`@defaultValue` — §5a permits `@public` and `@internal` alone",
    ]);
  });

  it("passes the inline `{@link}` cross-reference, which costs the reader no line", () => {
    expect(messages("/** A {@link ZoneConfig} whose `apex` is filled in. @public */\n")).toEqual([]);
  });

  it("passes a package scope, which is not a tag", () => {
    expect(messages("/** Wraps `@remix-run/headers` for `@y-core/forge`. @public */\n")).toEqual([]);
  });
});

describe("validateCommentBudget() — §5a form 3, a one-or-two-line inline why", () => {
  it("passes two consecutive `//` lines", () => {
    expect(messages("// The platform rewrites this header at the edge, so the inbound\n// value is not the client's.\nconst ip = 1;\n")).toEqual(
      [],
    );
  });

  it("fails three, and reports the line the run opens on", () => {
    const source = "const a = 1;\n// one\n// two\n// three\nconst b = 2;\n";

    expect(messages(source)).toEqual(["3 consecutive `//` lines — §5a form 3 caps an inline why at two"]);
    expect(lines(source)).toEqual([2]);
  });

  it("counts only comments that own their line, so three trailing notes are three whys", () => {
    expect(messages("const a = 1; // one\nconst b = 2; // two\nconst c = 3; // three\n")).toEqual([]);
  });

  it("breaks a run on a directive, which is not prose the reader pays for", () => {
    expect(messages("// one\n// two\n// oxlint-disable-next-line no-explicit-any\n// three\n// four\n")).toEqual([]);
  });

  it("passes a two-line why directly under a `/// <reference>`, which does not join the run", () => {
    expect(
      messages('/// <reference path="./worker.d.ts" />\n// The runtime types come from the pool,\n// not from the package.\nconst a = 1;\n'),
    ).toEqual([]);
  });

  it("passes a two-line block-form why, and fails a three-line one", () => {
    expect(messages("/* one\n   two */\nconst a = 1;\n/* one\n   two\n   three */\nconst b = 2;\n")).toEqual([
      "inline why spans 3 lines — §5a form 3 caps one at two",
    ]);
  });
});

describe("validateCommentBudget() — §5b, forbidden outright", () => {
  it("fails a section banner", () => {
    expect(messages("// ---- helpers ----\nconst a = 1;\n")).toEqual(["section banner — file structure is what files and exports are for"]);
  });

  it("fails a box-drawing separator", () => {
    expect(messages("// ────────────\nconst a = 1;\n")).toEqual(["section banner — file structure is what files and exports are for"]);
  });

  it("fails a commented-out binding, import and lone closer", () => {
    expect(messages('// const a = 1;\nconst b = 2;\n// import { x } from "./x";\nconst c = 3;\n// });\nconst d = 4;\n')).toEqual([
      "commented-out code — git holds it",
      "commented-out code — git holds it",
      "commented-out code — git holds it",
    ]);
  });

  it("does not mistake prose opening with a keyword for code", () => {
    expect(
      messages("// if the header is absent, the platform supplies one\n// return the first match rather than the longest\nconst a = 1;\n"),
    ).toEqual([]);
  });

  it("fails `TODO`, `FIXME` and `XXX`, whichever comment carries them", () => {
    expect(messages("// TODO: widen this\n/** FIXME @public */\nconst a = 1; // XXX\n")).toEqual([
      "`TODO`/`FIXME`/`XXX` in a comment — open a ledger task",
      "`TODO`/`FIXME`/`XXX` in a comment — open a ledger task",
      "`TODO`/`FIXME`/`XXX` in a comment — open a ledger task",
    ]);
  });
});

describe("validateCommentBudget() — §5f, a field gloss that earns nothing", () => {
  const field = (gloss: string, declaration: string): string => `interface Options {\n  ${gloss}\n  ${declaration}\n}\n`;

  it("fails a gloss whose words reduce to the field's own name", () => {
    expect(messages(field("/** The user's name. */", "name: string;"))).toEqual([
      "`name` — the gloss spells the field name back; §5f budgets nothing for that",
    ]);
  });

  it("fails the same gloss written on the field's own line", () => {
    expect(messages("interface Options {\n  /** Repository root. */ root: string;\n}\n")).toEqual([
      "`root` — the gloss spells the field name back; §5f budgets nothing for that",
    ]);
  });

  it("passes a gloss whose second clause adds a fact", () => {
    expect(messages(field("/** Repository root; every reported path is relative to it. */", "root: string;"))).toEqual([]);
  });

  it("passes a gloss carrying a default", () => {
    expect(messages(field('/** Directories walked for source files. Defaults to `["src"]`. */', "dirs?: string[];"))).toEqual([]);
  });

  it("passes a gloss that names the field and two things besides", () => {
    expect(messages(field("/** The role step it resolves through. */", "step: string;"))).toEqual([]);
  });

  it("passes a gloss that never names the field at all", () => {
    expect(messages(field("/** The custom property an exemption is about. */", "token: string;"))).toEqual([]);
  });

  it("splits a camel-case field name before comparing", () => {
    expect(messages(field("/** The maximum bytes. */", "maxBytes?: number;"))).toEqual([]);
    expect(messages(field("/** Max bytes. */", "maxBytes?: number;"))).toEqual([
      "`maxBytes` — the gloss spells the field name back; §5f budgets nothing for that",
    ]);
  });

  it("judges a field, not an export — a declaration is not a property signature", () => {
    expect(messages("/** Repository root. */\nexport const root = 1;\n")).toEqual([]);
  });

  it("reads past the visibility tags, which are markers rather than words", () => {
    expect(messages(field("/** Repository root. @internal */", "root: string;"))).toEqual([
      "`root` — the gloss spells the field name back; §5f budgets nothing for that",
    ]);
  });
});

describe("validateCommentBudget() — an inventory count", () => {
  it("fails a definite count of what exists", () => {
    expect(messages("// the five reads a model is built from\nconst a = 1;\n")).toEqual([
      "inventory count `the five reads` — a comment records that a thing exists, not how many",
    ]);
  });

  it("passes a count carried by a spec citation", () => {
    expect(messages("// RFC 5869 Appendix A, the three SHA-256 cases\nconst a = 1;\n")).toEqual([]);
  });

  it("passes a count carried by a unit", () => {
    expect(messages("// two variant bits in octet 8\nconst a = 1;\n")).toEqual([]);
  });

  it("passes a count that is a rule of the thing, not a tally of it", () => {
    expect(messages("// gets its full three guesses\nconst a = 1;\n")).toEqual([]);
    expect(messages("// all four arrow keys\nconst a = 1;\n")).toEqual([]);
    expect(messages("// its four fixed parts\nconst a = 1;\n")).toEqual([]);
  });

  it("passes a count the comment immediately enumerates", () => {
    expect(messages("// the four states — populated, empty, loading and failed\nconst a = 1;\n")).toEqual([]);
  });

  it("judges a block comment by the same rule", () => {
    expect(messages("/** Resolves the five reads. */\nexport const a = 1;\n")).toEqual([
      "inventory count `the five reads` — a comment records that a thing exists, not how many",
    ]);
  });
});

describe("validateCommentBudget() — the licence allowance", () => {
  const header = "// Adapted from upstream (MIT, Copyright (c) upstream)\n// itself after another (ISC)\n// https://example.test/upstream\n";

  it("waives the run cap for the leading run when the file is listed", () => {
    expect(messages(`${header}const a = 1;\n`, true)).toEqual([]);
  });

  it("holds the same run when it is not", () => {
    expect(messages(`${header}const a = 1;\n`)).toEqual(["3 consecutive `//` lines — §5a form 3 caps an inline why at two"]);
  });

  it("waives the leading run alone — a later one is prose, listed or not", () => {
    expect(messages(`${header}const a = 1;\n// one\n// two\n// three\n`, true)).toEqual([
      "3 consecutive `//` lines — §5a form 3 caps an inline why at two",
    ]);
  });
});
