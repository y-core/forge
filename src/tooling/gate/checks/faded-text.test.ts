import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { checkFadedText, fadedText } from "./faded-text";
import { gateFixtureRoot } from "./gate.fixture";
import type { ContrastPairInput } from "./types";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const fixtureRoot = (files: Record<string, string> = {}): string => {
  const root = gateFixtureRoot(files, "forge-faded-text-");
  roots.push(root);
  return root;
};

const ALERT = readFileSync(resolve(import.meta.dir, "../../../ui/core/alert.tsx"), "utf-8");
const DESCRIPTION = "text-sm leading-relaxed text-pretty";

const fadedAt = (token: string, percent: number, alpha: number): string =>
  `\`${token}\` paints at ${percent}% strength, which the contrast audit measures at 100% — drop it, or name the colour beside it and audit a pair whose foreground carries \`alpha: ${alpha}\``;

const unmeasurable = (token: string): string =>
  `\`${token}\` fades what this class paints by an amount the contrast audit cannot measure — write it as a number, or drop it`;

const messagesFor = (classes: string, pairs: readonly ContrastPairInput[] = []): string[] =>
  fadedText("src/ui/x.tsx", `const a = "${classes}";\n`, pairs).map((finding) => finding.message);

const modifiedAt = (token: string, percent: number, alpha: number): string =>
  `\`${token}\` paints its colour at ${percent}% strength, which the contrast audit measures at 100% — drop the modifier, or audit a pair whose foreground carries this colour at \`alpha: ${alpha}\``;

const openAtEnd = (quote: string, line: number): string =>
  `a \`${quote}\` string opened on line ${line} never closes, so the rest of this stylesheet goes unjudged — close it`;

const stylesheet = (css: string, pairs: readonly ContrastPairInput[] = []): string[] =>
  fadedText("src/ui/x.css", css, pairs).map((finding) => finding.message);

const FOREGROUND_AT_70: ContrastPairInput = {
  token: "--y",
  criterion: "1.4.3",
  foreground: { token: "--foreground", alpha: 0.7 },
  background: { token: "--background" },
};

const DESTRUCTIVE_AT_70: ContrastPairInput = {
  token: "--x",
  criterion: "1.4.3",
  foreground: { token: "--destructive-text", alpha: 0.7 },
  background: { token: "--muted" },
};

const SM_AT_70: ContrastPairInput = {
  token: "--z",
  criterion: "1.4.3",
  foreground: { token: "--sm", alpha: 0.7 },
  background: { token: "--background" },
};

describe("checkFadedText — the Alert description", () => {
  it("fails an AlertDescription faded to opacity-90, at its file and line", () => {
    const faded = ALERT.replace(`"${DESCRIPTION}"`, `"${DESCRIPTION} opacity-90"`);
    const line = faded.slice(0, faded.indexOf(`${DESCRIPTION} opacity-90`)).split("\n").length;
    const result = checkFadedText({ root: fixtureRoot({ "src/ui/core/alert.tsx": faded }), sources: ["src/ui"], pairs: [] });

    expect(faded).not.toBe(ALERT);
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([{ level: "fail", message: fadedAt("opacity-90", 90, 0.9), file: "src/ui/core/alert.tsx", line }]);
  });

  it("passes the Alert as it ships", () => {
    const result = checkFadedText({ root: fixtureRoot({ "src/ui/core/alert.tsx": ALERT }), sources: ["src/ui"], pairs: [] });

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });
});

describe("fadedText — which fades it judges", () => {
  for (const classes of [
    "disabled:opacity-50",
    "aria-disabled:opacity-50",
    "data-disabled:opacity-50",
    "group-disabled:opacity-50",
    "peer-disabled:opacity-50",
    "group-disabled/field:opacity-50",
    "aria-[disabled=true]:opacity-50",
    "data-[disabled]:opacity-50",
    "data-[disabled=true]:opacity-50",
    "group-data-[disabled]/field:opacity-50",
  ]) {
    it(`exempts the disabled chain ${classes}`, () => {
      expect(messagesFor(`text-sm ${classes}`)).toEqual([]);
    });
  }

  it("fails a fade under not-disabled, which paints the enabled state", () => {
    expect(messagesFor("text-sm not-disabled:opacity-70")).toEqual([fadedAt("not-disabled:opacity-70", 70, 0.7)]);
  });

  for (const token of [
    "aria-[disabled=false]:opacity-70",
    "data-[disabled=false]:opacity-70",
    "group-aria-[disabled=false]/field:opacity-70",
    "has-[select:disabled]:opacity-70",
  ]) {
    it(`fails a fade under ${token}, whose variant names disabled without matching the disabled state`, () => {
      expect(messagesFor(`text-sm ${token}`)).toEqual([fadedAt(token, 70, 0.7)]);
    });
  }

  for (const classes of ["opacity-0", "max-md:opacity-0", "group-open:opacity-100"]) {
    it(`passes the hidden or opaque ${classes}`, () => {
      expect(messagesFor(`text-sm ${classes}`)).toEqual([]);
    });
  }

  for (const { input, expected } of [
    { input: "opacity-[0.7]", expected: [fadedAt("opacity-[0.7]", 70, 0.7)] },
    { input: "opacity-[70%]", expected: [fadedAt("opacity-[70%]", 70, 0.7)] },
    { input: "opacity-(--fade)", expected: [unmeasurable("opacity-(--fade)")] },
  ]) {
    it(`judges the arbitrary value ${input}`, () => {
      expect(messagesFor(`text-sm ${input}`)).toEqual(expected);
    });
  }

  it("fails a fade behind an arbitrary variant, the Stack form", () => {
    expect(messagesFor("flex [&>*:nth-child(2)]:opacity-90")).toEqual([fadedAt("[&>*:nth-child(2)]:opacity-90", 90, 0.9)]);
  });

  it("reports a token repeated on one line once", () => {
    expect(messagesFor("text-sm opacity-70 opacity-70")).toEqual([fadedAt("opacity-70", 70, 0.7)]);
  });

  it("reports the line the literal sits on", () => {
    const source = ['const a = "text-sm";', "", 'const b = "text-sm opacity-70";', ""].join("\n");

    expect(fadedText("src/ui/x.tsx", source, []).map((finding) => finding.line)).toEqual([3]);
  });
});

describe("fadedText — a fade an audited alpha pair holds", () => {
  for (const classes of ["text-destructive-text opacity-70", "text-(--destructive-text) opacity-70"]) {
    it(`passes ${classes} beside a pair auditing that colour at that alpha`, () => {
      expect(messagesFor(classes, [DESTRUCTIVE_AT_70])).toEqual([]);
    });
  }

  for (const { input, pairs, why, expected } of [
    { input: "text-destructive-text opacity-80", pairs: [DESTRUCTIVE_AT_70], why: "the alpha differs", expected: [fadedAt("opacity-80", 80, 0.8)] },
    {
      input: "hover:text-destructive-text opacity-70",
      pairs: [DESTRUCTIVE_AT_70],
      why: "the variant chain differs",
      expected: [fadedAt("opacity-70", 70, 0.7)],
    },
    { input: "text-destructive-text opacity-70", pairs: [], why: "no pair is audited", expected: [fadedAt("opacity-70", 70, 0.7)] },
    { input: "text-sm opacity-70", pairs: [SM_AT_70], why: "text-sm sets a font size, not a colour", expected: [fadedAt("opacity-70", 70, 0.7)] },
  ]) {
    it(`fails ${input} when ${why}`, () => {
      expect(messagesFor(input, pairs)).toEqual(expected);
    });
  }
});

describe("fadedText — a text colour's alpha modifier", () => {
  for (const { input, expected } of [
    { input: "text-foreground/70", expected: [modifiedAt("text-foreground/70", 70, 0.7)] },
    { input: "hover:text-muted-foreground/[0.7]", expected: [modifiedAt("hover:text-muted-foreground/[0.7]", 70, 0.7)] },
    { input: "text-(--destructive-text)/[70%]", expected: [modifiedAt("text-(--destructive-text)/[70%]", 70, 0.7)] },
    { input: "text-foreground/(--fade)", expected: [unmeasurable("text-foreground/(--fade)")] },
  ]) {
    it(`fails the faded text colour ${input}`, () => {
      expect(messagesFor(`text-sm ${input}`)).toEqual(expected);
    });
  }

  for (const classes of ["disabled:text-foreground/50", "aria-disabled:text-foreground/50"]) {
    it(`exempts the disabled chain ${classes}`, () => {
      expect(messagesFor(classes)).toEqual([]);
    });
  }

  for (const classes of ["text-foreground/100", "text-foreground/0"]) {
    it(`passes the opaque or hidden ${classes}`, () => {
      expect(messagesFor(classes)).toEqual([]);
    });
  }

  for (const classes of ["text-sm/6", "text-base/loose", "text-[14px]/6", "bg-muted/40", "ring-destructive-text/20", "text-shadow-md/20"]) {
    it(`passes ${classes}, which is not a text colour`, () => {
      expect(messagesFor(classes)).toEqual([]);
    });
  }

  it("passes a modifier an audited pair carries at that colour and alpha", () => {
    expect(messagesFor("text-foreground/70", [FOREGROUND_AT_70])).toEqual([]);
  });

  it("fails a modifier whose alpha the audited pair does not carry", () => {
    expect(messagesFor("text-foreground/80", [FOREGROUND_AT_70])).toEqual([modifiedAt("text-foreground/80", 80, 0.8)]);
  });
});

describe("fadedText — an `@apply` in a stylesheet", () => {
  it("fails an opacity fade it applies, at the line of its `@apply`", () => {
    const findings = fadedText("src/ui/x.css", ".note {\n  @apply text-sm opacity-90;\n}\n", []);

    expect(findings.map((finding) => [finding.message, finding.line])).toEqual([[fadedAt("opacity-90", 90, 0.9), 2]]);
  });

  it("fails a text colour's modifier it applies", () => {
    expect(stylesheet(".note {\n  @apply text-foreground/70;\n}\n")).toEqual([modifiedAt("text-foreground/70", 70, 0.7)]);
  });

  it("judges a block's last `@apply` that ends at the brace with no semicolon", () => {
    expect(stylesheet(".x { @apply opacity-90 }\n")).toEqual([fadedAt("opacity-90", 90, 0.9)]);
    expect(stylesheet(".x { color: red; @apply text-foreground/70 }\n")).toEqual([modifiedAt("text-foreground/70", 70, 0.7)]);
    expect(stylesheet(".x:disabled { @apply opacity-50 }\n")).toEqual([]);
  });

  it("passes the state-disabled utility as forge-ui.css ships it", () => {
    const css = [
      "@utility state-disabled {",
      '  &:is(:disabled, [aria-disabled="true"], :has(:disabled), :has(> [data-slot~="select"][aria-disabled="true"])),',
      "  fieldset:disabled & {",
      "    @apply opacity-50;",
      "  }",
      '  &:is(:disabled, [aria-disabled="true"], :has(:disabled), :has(> [data-slot~="select"][aria-disabled="true"])):not([data-slot~="tooltip-trigger"]),',
      '  fieldset:disabled &:not([data-slot~="tooltip-trigger"]) {',
      "    @apply pointer-events-none;",
      "  }",
      "}",
      "",
    ].join("\n");

    expect(stylesheet(css)).toEqual([]);
  });

  it("passes a fade under a disabled ancestor selector", () => {
    expect(stylesheet("fieldset:disabled .x { @apply opacity-50; }\n")).toEqual([]);
  });

  it("fails a fade when one selector of the list paints an enabled state", () => {
    expect(stylesheet(".x:disabled, .x:hover { @apply opacity-50; }\n")).toEqual([fadedAt("opacity-50", 50, 0.5)]);
  });

  it("fails a fade when one argument of an :is() paints an enabled state", () => {
    expect(stylesheet('.x:is(:hover, [aria-disabled="true"]) { @apply opacity-50; }\n')).toEqual([fadedAt("opacity-50", 50, 0.5)]);
  });

  it("fails a fade under :not(:disabled), which paints the enabled state", () => {
    expect(stylesheet(".x:not(:disabled) { @apply opacity-50; }\n")).toEqual([fadedAt("opacity-50", 50, 0.5)]);
  });

  it("passes a fade nested inside a disabled-only rule", () => {
    expect(stylesheet(".x:disabled { &:hover { @apply opacity-50; } }\n")).toEqual([]);
  });

  it("passes a fade behind a disabled variant chain", () => {
    expect(stylesheet(".x { @apply disabled:opacity-50; }\n")).toEqual([]);
  });

  it("does not read a brace inside a string as a block boundary", () => {
    expect(stylesheet('.x:disabled { content: "{"; @apply opacity-50 }\n.y { @apply opacity-50 }\n')).toEqual([fadedAt("opacity-50", 50, 0.5)]);
    expect(stylesheet(".x:disabled { content: '{'; @apply opacity-50 }\n.y { @apply opacity-50 }\n")).toEqual([fadedAt("opacity-50", 50, 0.5)]);
    expect(stylesheet('.x:disabled { content: "}"; @apply opacity-50 }\n')).toEqual([]);
  });

  it("does not read a brace inside an attribute selector as a block boundary", () => {
    expect(stylesheet('.x:disabled [data-k="}"] { @apply opacity-50 }\n.y { @apply opacity-90 }\n')).toEqual([fadedAt("opacity-90", 90, 0.9)]);
  });

  it("ends a string at an unescaped newline, as CSS does, and judges the rules after it", () => {
    expect(stylesheet('.a { content: "oops; }\n.y { @apply opacity-50 }\n')).toEqual([fadedAt("opacity-50", 50, 0.5)]);
    expect(stylesheet(".a { content: 'oops; }\n.y { @apply opacity-50 }\n.z { content: 'x' }\n")).toEqual([fadedAt("opacity-50", 50, 0.5)]);
  });

  it("continues a string past an escaped newline", () => {
    expect(stylesheet('.a { content: "a\\\nb"; }\n.y { @apply opacity-50 }\n')).toEqual([fadedAt("opacity-50", 50, 0.5)]);
  });

  it("fails a string still open at the end of the file, at the line it opens on", () => {
    const findings = fadedText("src/ui/x.css", '.y { @apply opacity-50 }\n.a { content: "open', []);

    expect(findings.map((finding) => [finding.message, finding.line])).toEqual([
      [fadedAt("opacity-50", 50, 0.5), 1],
      [openAtEnd('"', 2), 2],
    ]);
  });

  it("judges neither a commented-out `@apply` nor a plain declaration", () => {
    expect(stylesheet("/* @apply opacity-50; */\n.x { opacity: 0.7; }\n")).toEqual([]);
  });
});

describe("checkFadedText — what it walks", () => {
  it("scans a component but not a spec, a browser spec or a fixture", () => {
    const literal = 'export const a = "text-sm opacity-70";\n';
    const root = fixtureRoot({
      "src/ui/x.tsx": literal,
      "src/ui/x.test.tsx": literal,
      "src/ui/x.browser.ts": literal,
      "src/ui/x.fixture.ts": literal,
    });

    expect(checkFadedText({ root, sources: ["src/ui"], pairs: [] }).findings.map((finding) => finding.file)).toEqual(["src/ui/x.tsx"]);
  });

  it("scans a stylesheet's `@apply`", () => {
    const root = fixtureRoot({ "src/ui/a.css": ".a {\n  @apply opacity-70;\n}\n", "src/ui/x.tsx": 'export const a = "text-sm";\n' });

    expect(checkFadedText({ root, sources: ["src/ui"], pairs: [] }).findings.map((finding) => [finding.file, finding.line])).toEqual([
      ["src/ui/a.css", 2],
    ]);
  });

  it("fails on a `sources` entry naming nothing under the root", () => {
    const root = fixtureRoot({ "src/ui/x.tsx": 'export const a = "text-sm";\n' });
    const result = checkFadedText({ root, sources: ["src/ui", "src/uii"], pairs: [] });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["`sources` entry `src/uii` names no directory under the root"]);
  });

  it("refuses a green verdict when it scanned nothing", () => {
    const root = fixtureRoot({ "src/ui/a.md": "text opacity-70\n" });
    const result = checkFadedText({ root, sources: ["src/ui"], pairs: [] });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`src/ui` matched no source — refusing to report a green faded-text gate that scanned nothing",
    ]);
  });
});
