import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { fail } from "../finding";
import { checkCrossEngineTags, findCrossEngineUnits, findEngineReaders, resolveFixtureReaders, validateCrossEngineTags } from "./cross-engine-tags";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const spec = (...lines: string[]): string => lines.join("\n");

const tempRoot = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "forge-cross-engine-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content, "utf-8");
  }
  return root;
};

const shape = (source: string) => findCrossEngineUnits(source)?.map((unit) => ({ line: unit.line, tagged: unit.tag !== null })) ?? null;

const FILE = "src/ui/a.browser.ts";
const TAG = '{ tag: "@cross-engine" }';
const UNTAGGED = "an untagged top-level block reads what the engine computes";
const MISPLACED = '@cross-engine is spelled outside a top-level block\'s { tag: "@cross-engine" }';
const advice = (names: string) => `reads ${names} — add { tag: "@cross-engine" }`;

describe("findCrossEngineUnits", () => {
  it("finds a top-level describe, a bare test, a serial describe and a test inside a top-level for, each at its line", () => {
    const source = spec(
      'import { test } from "@playwright/test";',
      "",
      'test.describe("outer", () => {',
      '  test("nested", async () => {});',
      "});",
      "",
      'test("bare", async () => {});',
      "",
      'test.describe.serial("serial", () => {});',
      "",
      'for (const tone of ["a", "b"]) {',
      "  test(`tone ${tone}`, async () => {});",
      "}",
    );
    expect(shape(source)).toEqual([
      { line: 3, tagged: false },
      { line: 7, tagged: false },
      { line: 9, tagged: false },
      { line: 12, tagged: false },
    ]);
  });

  it("finds a test inside a for nested in a top-level for", () => {
    const source = spec('for (const a of ["x"]) {', '  for (const b of ["y"]) {', "    test(`${a} ${b}`, async () => {});", "  }", "}");
    expect(shape(source)).toEqual([{ line: 3, tagged: false }]);
  });

  it("does not find a nested test, test.use, test.beforeEach or test.describe.configure", () => {
    const source = spec(
      "test.use({ viewport: null });",
      "test.beforeEach(async () => {});",
      'test.describe.configure({ mode: "serial" });',
      'test.describe("outer", () => {',
      '  test("nested", async () => {});',
      "});",
    );
    expect(shape(source)).toEqual([{ line: 4, tagged: false }]);
  });

  it("reads the tag from a second argument split onto its own line after a long title", () => {
    const source = spec("test(", "  `a title long enough to wrap`,", `  ${TAG},`, "  async () => {},", ");");
    const [unit] = findCrossEngineUnits(source) ?? [];
    expect(unit === undefined || unit.tag === null ? null : { line: unit.line, tag: source.slice(unit.tag.start, unit.tag.end) }).toEqual({
      line: 1,
      tag: TAG,
    });
  });

  const untagged: { label: string; source: string }[] = [
    { label: "an array tag", source: 'test.describe("a", { tag: ["@cross-engine"] }, () => {});' },
    { label: "a title ending in @cross-engine", source: 'test.describe("a @cross-engine", () => {});' },
  ];

  for (const { label, source } of untagged) {
    it(`reads no tag from ${label}`, () => {
      expect(shape(source)).toEqual([{ line: 1, tagged: false }]);
    });
  }

  it("survives a template title holding a substitution, and skips a column-0 test( inside a multi-line template", () => {
    const source = spec(
      'test(`case ${name} and ${"}"}`, async () => {});',
      "const HTML = `",
      'test("inside a string", () => {});',
      "`;",
      'test("real", async () => {});',
    );
    expect(shape(source)).toEqual([
      { line: 1, tagged: false },
      { line: 5, tagged: false },
    ]);
  });

  it("survives regex literals holding a bracket, a quote or a negated class", () => {
    const source = spec(
      String.raw`const COLOR = /(\S+\([^)]*\)|#[0-9a-f]+)/i;`,
      String.raw`const parts = value.split(/,(?![^(]*\))/);`,
      String.raw`const QUOTED = /"[^"]*"/;`,
      `test.describe("after the regexes", ${TAG}, () => {});`,
    );
    expect(shape(source)).toEqual([{ line: 4, tagged: true }]);
  });

  it("returns null for an unterminated string", () => {
    expect(findCrossEngineUnits('test("never closes, async () => {});')).toBeNull();
  });

  it("returns null for a closer with no opener", () => {
    expect(findCrossEngineUnits(spec(`test.describe("balanced", ${TAG}, () => {});`, "});"))).toBeNull();
  });
});

describe("findEngineReaders", () => {
  const sorted = (readers: Set<string> | null) => (readers === null ? null : [...readers].sort());

  it("counts a function helper and a const arrow helper that read computed style, and a helper reaching one transitively", () => {
    const source = spec(
      "function paint(el) { return getComputedStyle(el).color; }",
      "const hue = (el) => getComputedStyle(el).backgroundColor;",
      "function viaPaint(el) { return paint(el); }",
      "const sum = (a, b) => a + b;",
    );
    expect(sorted(findEngineReaders(source))).toEqual(["hue", "paint", "viaPaint"]);
  });

  it("does not count a pure helper", () => {
    expect(sorted(findEngineReaders("const sum = (a, b) => a + b;"))).toEqual([]);
  });

  it("counts a caller of a seeded imported reader", () => {
    expect(sorted(findEngineReaders("const shade = (el) => paint(el);", new Set(["paint"])))).toEqual(["paint", "shade"]);
  });

  it("does not count a member access spelled like a reader", () => {
    const source = spec("function paint(el) { return getComputedStyle(el).color; }", "const other = (theme) => theme.paint();");
    expect(sorted(findEngineReaders(source))).toEqual(["paint"]);
  });

  it("returns null for an unterminated string", () => {
    expect(findEngineReaders('const a = "never closes;')).toBeNull();
  });
});

describe("validateCrossEngineTags", () => {
  const block = (tag: string, body: string) =>
    spec(`test.describe("reads"${tag}, () => {`, '  test("case", async ({ page }) => {', `    ${body}`, "  });", "});");

  const reads: { read: string; body: string }[] = [
    { read: "computed style", body: "await page.evaluate(() => getComputedStyle(document.body).color);" },
    { read: "Playwright computed style", body: 'await expect(page.locator("a")).toHaveCSS("color", "red");' },
    { read: "layout box", body: "await page.evaluate(() => document.body.getBoundingClientRect().top);" },
    { read: "layout box", body: 'await page.locator("a").boundingBox();' },
    { read: "layout metric", body: "await page.evaluate(() => document.body.scrollLeft);" },
    { read: "hit test", body: "await page.evaluate(() => document.elementFromPoint(1, 1));" },
    { read: "top layer", body: 'await expect(page.locator(":popover-open")).toHaveCount(1);' },
    { read: "top layer", body: 'await page.evaluate(() => document.querySelector("dialog").showModal());' },
    { read: "focus heuristic", body: 'await expect(page.locator(":focus-visible")).toHaveCount(1);' },
    { read: "running animations", body: "await page.evaluate(() => document.getAnimations().length);" },
    { read: "visibility", body: "await page.evaluate(() => document.body.checkVisibility());" },
    { read: "media query", body: 'await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);' },
  ];

  for (const { read, body } of reads) {
    it(`fails an untagged describe whose case runs \`${body}\`, naming ${read}`, () => {
      expect(validateCrossEngineTags(FILE, block("", body))).toEqual([fail(UNTAGGED, { file: FILE, line: 1, detail: [advice(read)] })]);
    });

    it(`passes the same describe tagged, running \`${body}\``, () => {
      expect(validateCrossEngineTags(FILE, block(`, ${TAG}`, body))).toEqual([]);
    });
  }

  it("names every read in the table's order, then the in-file helper it calls", () => {
    const source = spec(
      "function paint(el) { return getComputedStyle(el).color; }",
      "",
      'test("mixed", async ({ page }) => {',
      '  await page.evaluate(() => matchMedia("(min-width: 1px)").matches && document.body.getBoundingClientRect().top);',
      "  await page.evaluate(() => paint(document.body));",
      "});",
    );
    expect(validateCrossEngineTags(FILE, source)).toEqual([
      fail(UNTAGGED, { file: FILE, line: 3, detail: [advice("layout box, media query, paint")] }),
    ]);
  });

  it("names a reader reached through an imported name", () => {
    const source = spec('test("imported", async ({ page }) => {', "  await hue(page);", "});");
    expect(validateCrossEngineTags(FILE, source, new Set(["hue"]))).toEqual([fail(UNTAGGED, { file: FILE, line: 1, detail: [advice("hue")] })]);
  });

  const loop = (tag: string) =>
    spec(
      'for (const tone of ["a", "b"]) {',
      `  test(\`tone \${tone}\`${tag}, async ({ page }) => {`,
      "    await page.evaluate(() => getComputedStyle(document.body).color);",
      "  });",
      "}",
    );

  it("fails an untagged test inside a top-level for that reads computed style, at the inner test's line", () => {
    expect(validateCrossEngineTags(FILE, loop(""))).toEqual([fail(UNTAGGED, { file: FILE, line: 2, detail: [advice("computed style")] })]);
  });

  it("passes the test inside a top-level for once it is tagged", () => {
    expect(validateCrossEngineTags(FILE, loop(`, ${TAG}`))).toEqual([]);
  });

  const excluded: { label: string; body: string }[] = [
    { label: "document.activeElement", body: "await page.evaluate(() => document.activeElement?.id);" },
    { label: "toBeVisible", body: 'await expect(page.locator("a")).toBeVisible();' },
    { label: "contrastRatio", body: 'expect(contrastRatio("#000000", "#ffffff")).toBe(21);' },
  ];

  for (const { label, body } of excluded) {
    it(`passes an untagged block that reads only ${label}`, () => {
      expect(validateCrossEngineTags(FILE, block("", body))).toEqual([]);
    });
  }

  it("passes a tagged block that reads nothing", () => {
    expect(validateCrossEngineTags(FILE, block(`, ${TAG}`, "expect(1).toBe(1);"))).toEqual([]);
  });

  it("fails @cross-engine in a describe title, a nested title, a nested tag object and a tagged unit's nested case, each at its line", () => {
    const source = spec(
      'test.describe("title @cross-engine", () => {});',
      "",
      'test.describe("outer", () => {',
      '  test("nested @cross-engine", async () => {});',
      `  test("nested object", ${TAG}, async () => {});`,
      "});",
      "",
      `test.describe("tagged", ${TAG}, () => {`,
      `  test("inner", ${TAG}, async () => {});`,
      "});",
    );
    expect(validateCrossEngineTags(FILE, source)).toEqual([
      fail(MISPLACED, { file: FILE, line: 1 }),
      fail(MISPLACED, { file: FILE, line: 4 }),
      fail(MISPLACED, { file: FILE, line: 5 }),
      fail(MISPLACED, { file: FILE, line: 9 }),
    ]);
  });

  it("passes @cross-engine written inside a comment", () => {
    const source = spec("// runs as @cross-engine on firefox", "/* @cross-engine */", 'test("plain", async () => {});');
    expect(validateCrossEngineTags(FILE, source)).toEqual([]);
  });

  it("fails a source it cannot lex with one finding and judges none of its blocks", () => {
    const source = spec('test("never closes, async ({ page }) => {', "  await page.evaluate(() => getComputedStyle(document.body).color);", "});");
    expect(validateCrossEngineTags(FILE, source)).toEqual([fail("the spec cannot be lexed, so none of its blocks is judged", { file: FILE })]);
  });
});

describe("resolveFixtureReaders", () => {
  const root = tempRoot({
    "src/ui/x.fixture.ts": spec("export function paint(el) { return getComputedStyle(el).color; }", "export const plain = (a) => a;"),
    "src/ui/color.ts": "export function paint(el) { return getComputedStyle(el).color; }",
    "src/ui/bad.fixture.ts": 'export const broken = "never closes;',
  });

  const resolved = (source: string) => {
    const { readers, findings } = resolveFixtureReaders(root, FILE, source);
    return { readers: [...readers].sort(), findings };
  };

  it("follows a named import from a sibling fixture to the reader it declares", () => {
    expect(resolved('import { paint, plain } from "./x.fixture";')).toEqual({ readers: ["paint"], findings: [] });
  });

  it("records a reader under its local alias", () => {
    expect(resolved('import { paint as hue } from "./x.fixture";')).toEqual({ readers: ["hue"], findings: [] });
  });

  it("ignores a type-only import", () => {
    expect(resolved('import type { paint } from "./x.fixture";')).toEqual({ readers: [], findings: [] });
  });

  it("ignores a relative import of a module that is not a fixture", () => {
    expect(resolved('import { paint } from "./color";')).toEqual({ readers: [], findings: [] });
  });

  it("fails a fixture it cannot lex, at the fixture's own path", () => {
    expect(resolved('import { broken } from "./bad.fixture";')).toEqual({
      readers: [],
      findings: [fail("the fixture cannot be lexed, so readers through it are unseen", { file: "src/ui/bad.fixture.ts" })],
    });
  });
});

describe("checkCrossEngineTags", () => {
  it("refuses to report green over a directory holding no browser spec", () => {
    const outcome = checkCrossEngineTags({ root: process.cwd(), sources: ["no-such-directory"] });
    expect({ ok: outcome.ok, messages: outcome.findings.map((finding) => finding.message) }).toEqual({
      ok: false,
      messages: ["`no-such-directory` matched no browser spec — refusing to report a green cross-engine-tags gate that scanned nothing"],
    });
  });

  it("fails on a `sources` entry naming no directory, even beside one that finds specs", () => {
    const outcome = checkCrossEngineTags({ root: process.cwd(), sources: ["src", "no-such-directory"] });
    expect({ ok: outcome.ok, messages: outcome.findings.map((finding) => finding.message) }).toEqual({
      ok: false,
      messages: ["`sources` entry `no-such-directory` names no directory under the root"],
    });
  });

  it("fails an untagged spec block reading through an imported fixture, then closes with the rule", () => {
    const root = tempRoot({
      "src/x.fixture.ts": "export function paint(el) { return getComputedStyle(el).color; }",
      "src/a.browser.ts": spec('import { paint } from "./x.fixture";', "", 'test("hue", async ({ page }) => {', "  await paint(page);", "});"),
    });
    expect(checkCrossEngineTags({ root })).toEqual({
      ok: false,
      findings: [
        fail(UNTAGGED, { file: "src/a.browser.ts", line: 3, detail: [advice("paint")] }),
        fail(
          "A top-level block that reads what the engine computes runs on Firefox and WebKit too (docs/TEST_RUNNERS.md §1g); a false positive is tagged, never excused.",
        ),
      ],
      summary: "1 browser specs tag every top-level block that reads what the engine computes.",
    });
  });

  it("passes a spec whose reading block is tagged", () => {
    const root = tempRoot({
      "src/a.browser.ts": spec(`test("hue", ${TAG}, async ({ page }) => {`, '  await page.locator("a").boundingBox();', "});"),
    });
    expect(checkCrossEngineTags({ root })).toEqual({
      ok: true,
      findings: [],
      summary: "1 browser specs tag every top-level block that reads what the engine computes.",
    });
  });

  it("passes over this repository's own src", () => {
    expect(checkCrossEngineTags({ root: process.cwd() }).findings).toEqual([]);
  });
});
