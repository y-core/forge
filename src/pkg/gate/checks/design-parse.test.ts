import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type DesignFinding,
  findArbitraryValues,
  findBareFocus,
  findBarrelImports,
  findColorLiterals,
  findCustomPropertyCitations,
  findInlineStyles,
  findNestedCards,
  findRawControls,
  findRawThemeUtilities,
  findRuleCitations,
  findRuleMarkers,
  findSourceViolations,
  findViewportUnits,
  formatDesignFinding,
  isSuppressed,
  isValidRuleId,
  parseDeclaredCustomProperties,
  RULE_CORPUS_PATH,
  type RuleId,
} from "./design-parse";

const FILE = "src/ui/core/fixture.tsx";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function one(line: string): string {
  return line;
}

describe("findColorLiterals() — literals inside a class position", () => {
  const flagged: { line: string; hit: string }[] = [
    { line: '<div class="bg-[#fff]" />', hit: "#fff" },
    { line: '<div class="text-[#1a2b3c]" />', hit: "#1a2b3c" },
    { line: 'const cls = cn("bg-[rgb(0_0_0)]");', hit: "rgb(" },
    { line: 'const cls = cn("bg-[rgba(0,0,0,0.5)]");', hit: "rgba(" },
    { line: 'const cls = asClass("bg-[hsl(0_0%_0%)]");', hit: "hsl(" },
    { line: '<div class="bg-[oklch(0.7_0.19_22)]" />', hit: "oklch(" },
  ];

  for (const { line, hit } of flagged) {
    it(`flags \`${hit}\` in ${line}`, () => {
      expect(findColorLiterals(one(line), FILE)).toEqual([
        {
          file: FILE,
          line: 1,
          ruleId: "forge-ui-color-token-only",
          detail: `raw colour literal \`${hit}\` in a class string — resolve the colour through a semantic token`,
        },
      ]);
    });
  }

  it("reports a literal once, however many patterns see it", () => {
    expect(findColorLiterals(one('<div class="bg-[#fff] text-[#fff]" />'), FILE)).toHaveLength(1);
  });

  it("reports the 1-indexed line", () => {
    const source = ["<div>", '  <span class="bg-[#fff]" />', "</div>"].join("\n");

    expect(findColorLiterals(source, FILE).map((f) => f.line)).toEqual([1 + 1]);
  });
});

describe("findColorLiterals() — the constructs it must not flag", () => {
  const allowed: string[] = [
    '<div class="bg-red-50 border-red-200 text-red-900 dark:bg-red-950 dark:border-red-800 dark:text-red-200" />',
    '<div class="bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-800" />',
    '<div class="border-blue-200 dark:border-blue-800" />',
    "<path stroke='#163030' stroke-width='2' />",
    'const brand = "#163030";',
  ];

  for (const line of allowed) {
    it(`leaves ${line} alone`, () => {
      expect(findColorLiterals(one(line), FILE)).toEqual([]);
    });
  }

  it("honours a suppression comment on the line above", () => {
    const source = ["/* design-allow: forge-ui-color-token-only — the brand mark is fixed by the trademark. */", '<div class="bg-[#fff]" />'].join(
      "\n",
    );

    expect(findColorLiterals(source, FILE)).toEqual([]);
  });

  it("does not honour a suppression naming a different rule", () => {
    const source = ["/* design-allow: forge-ui-viewport-units — unrelated. */", '<div class="bg-[#fff]" />'].join("\n");

    expect(findColorLiterals(source, FILE)).toHaveLength(1);
  });
});

describe("findRawThemeUtilities() — a palette utility with no dark counterpart", () => {
  const detail = (written: string, family: string): string =>
    `\`${written}\` has no \`dark:${family}-*\` counterpart beside it — a raw palette utility survives the theme switch`;

  for (const [line, written, family] of [
    ['<div class="bg-yellow-100" />', "bg-yellow-100", "bg-yellow"],
    ["const cls = cn('text-red-800');", "text-red-800", "text-red"],
    ['<div class="border-emerald-200" />', "border-emerald-200", "border-emerald"],
    ['<div class="hover:bg-blue-50" />', "hover:bg-blue-50", "bg-blue"],
    ['<div class="ring-slate-950" />', "ring-slate-950", "ring-slate"],
  ] as const) {
    it(`flags \`${written}\` in ${line}`, () => {
      expect(findRawThemeUtilities(one(line), FILE)).toEqual([
        { file: FILE, line: 1, ruleId: "forge-ui-color-theme-no-raw-utility", detail: detail(written, family) },
      ]);
    });
  }

  it("reports a family once however many stops of it the line writes", () => {
    expect(findRawThemeUtilities(one('<div class="bg-red-100 hover:bg-red-200" />'), FILE)).toEqual([
      { file: FILE, line: 1, ruleId: "forge-ui-color-theme-no-raw-utility", detail: detail("bg-red-100", "bg-red") },
    ]);
  });

  it("reports each unpaired family on the line, in the order written", () => {
    expect(findRawThemeUtilities(one('<div class="bg-red-100 text-red-800" />'), FILE).map((f) => f.detail)).toEqual([
      detail("bg-red-100", "bg-red"),
      detail("text-red-800", "text-red"),
    ]);
  });

  it("reports the 1-indexed line", () => {
    const source = ["<div>", '  <span class="bg-yellow-100" />', "</div>"].join("\n");

    expect(findRawThemeUtilities(source, FILE).map((f) => f.line)).toEqual([2]);
  });
});

describe("findRawThemeUtilities() — the constructs it must not flag", () => {
  const allowed: string[] = [
    'warning: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900 dark:text-yellow-800 dark:border-yellow-200",',
    '<div class="bg-red-100 dark:bg-red-900" />',
    '<div class="bg-muted text-muted-foreground border-border" />',
    '<div class="gap-2 text-xs z-50 p-4" />',
    '<div class="bg-primary text-primary-foreground" />',
  ];

  for (const line of allowed) {
    it(`leaves ${line} alone`, () => {
      expect(findRawThemeUtilities(one(line), FILE)).toEqual([]);
    });
  }

  it("requires the counterpart to match on utility and hue, not merely to be some dark class", () => {
    expect(findRawThemeUtilities(one('<div class="bg-red-100 dark:text-red-200" />'), FILE).map((f) => f.detail)).toEqual([
      "`bg-red-100` has no `dark:bg-red-*` counterpart beside it — a raw palette utility survives the theme switch",
    ]);
  });

  it("scopes the pairing to the line — a pair split across two lines still reports", () => {
    const source = ['  class={cn("bg-red-100",', '    "dark:bg-red-900")}'].join("\n");

    expect(findRawThemeUtilities(source, FILE)).toHaveLength(1);
  });

  it("honours a suppression comment on the line above", () => {
    const source = [
      "/* design-allow: forge-ui-color-theme-no-raw-utility — the swatch shows the light stop itself. */",
      '<div class="bg-yellow-100" />',
    ].join("\n");

    expect(findRawThemeUtilities(source, FILE)).toEqual([]);
  });

  it("does not honour a suppression naming a different rule", () => {
    const source = ["/* design-allow: forge-ui-color-token-only — unrelated. */", '<div class="bg-yellow-100" />'].join("\n");

    expect(findRawThemeUtilities(source, FILE)).toHaveLength(1);
  });
});

describe("findInlineStyles()", () => {
  const detail = "`style=` attribute — the renderer drops it; express the rule as a class";

  it("flags a `style=` attribute", () => {
    expect(findInlineStyles(one('<div style="color: red">x</div>'), FILE)).toEqual([
      { file: FILE, line: 1, ruleId: "forge-ui-no-inline-style", detail },
    ]);
  });

  it("flags a JSX expression-valued `style=` attribute", () => {
    expect(findInlineStyles(one("<div style={{ color }}>x</div>"), FILE)).toEqual([
      { file: FILE, line: 1, ruleId: "forge-ui-no-inline-style", detail },
    ]);
  });

  it("flags the attribute once per line, not once per occurrence", () => {
    expect(findInlineStyles(one('<div style="a"><span style="b" /></div>'), FILE)).toHaveLength(1);
  });

  it("leaves a hyphenated attribute merely ending in `style` alone", () => {
    expect(findInlineStyles(one('<div data-style="ghost" />'), FILE)).toEqual([]);
  });

  it("leaves an identifier merely containing the substring alone", () => {
    expect(findInlineStyles(one("const lifestyle = 1;"), FILE)).toEqual([]);
    expect(findInlineStyles(one("const styles = classFor(variant);"), FILE)).toEqual([]);
  });

  it("flags a bare `style =` binding — the matcher is textual and cannot see it is not an attribute", () => {
    expect(findInlineStyles(one('const style = "color: red";'), FILE)).toHaveLength(1);
  });

  it("honours a same-line suppression", () => {
    expect(
      findInlineStyles(one('<div style="--x: 1" /> /* design-allow: forge-ui-no-inline-style — a custom property the renderer forwards. */'), FILE),
    ).toEqual([]);
  });
});

describe("findArbitraryValues() — arbitrary values on scale-bearing utilities", () => {
  const flagged = ['<p class="text-[13px]" />', '<p class="p-[7px]" />', '<p class="bg-[#fff]" />', '<p class="md:p-[7px]" />'];
  const hits = ["text-[13px]", "p-[7px]", "bg-[#fff]", "p-[7px]"];

  for (const [i, line] of flagged.entries()) {
    const hit = hits[i] ?? "";
    it(`flags \`${hit}\` in ${line}`, () => {
      expect(findArbitraryValues(one(line), FILE)).toEqual([
        { file: FILE, line: 1, ruleId: "forge-ui-spacing-scale-only", detail: `arbitrary value \`${hit}\` where a scale value exists` },
      ]);
    });
  }
});

describe("findArbitraryValues() — the brackets it must not flag", () => {
  const allowed: string[] = [
    '<div class="data-[popup-open]:rotate-180" />',
    '<div class="has-[select:disabled]:opacity-50" />',
    '<div class="group-[.is-open]:block" />',
    '<div class="peer-[.is-invalid]:text-destructive" />',
    '<div class="supports-[display:grid]:grid" />',
    '<div class="aria-[current=page]:font-medium" />',
    '<div class="[&_svg]:size-4" />',
    '<div class="[[data-slot~=control]]:w-full" />',
    '<div class="max-h-[60vh]" />',
    '<div class="min-w-[10rem]" />',
    '<div class="min-w-[8rem]" />',
    '<div class="rounded-[inherit]" />',
    '<div class="w-[calc(100%-2rem)]" />',
  ];

  for (const line of allowed) {
    it(`leaves ${line} alone`, () => {
      expect(findArbitraryValues(one(line), FILE)).toEqual([]);
    });
  }

  it("honours the JSX expression-container suppression the corpus's own components use", () => {
    const source = [
      "{/* design-allow: forge-ui-spacing-scale-only — no font-size step equals 11px; `text-xs` is 12px. */}",
      "{hint ? <p class='mb-2 text-[11px] text-muted-foreground'>{hint}</p> : null}",
    ].join("\n");

    expect(findArbitraryValues(source, FILE)).toEqual([]);
  });
});

describe("findViewportUnits()", () => {
  const detail = (hit: string): string => `\`${hit}\` measures the layout viewport — use \`min-h-dvh\``;

  for (const [line, hit] of [
    ['<div class="h-screen" />', "h-screen"],
    ['<div class="w-screen" />', "w-screen"],
    ['<div class="md:h-screen" />', "h-screen"],
  ] as const) {
    it(`flags \`${hit}\` in ${line}`, () => {
      expect(findViewportUnits(one(line), FILE)).toEqual([{ file: FILE, line: 1, ruleId: "forge-ui-viewport-units", detail: detail(hit) }]);
    });
  }

  for (const line of ['<div class="max-h-screen" />', '<div class="min-h-screen" />', '<div class="h-screen-ish" />']) {
    it(`leaves ${line} alone`, () => {
      expect(findViewportUnits(one(line), FILE)).toEqual([]);
    });
  }

  it("reports both units on a line once each", () => {
    expect(findViewportUnits(one('<div class="h-screen w-screen h-screen" />'), FILE).map((f) => f.detail)).toEqual([
      detail("h-screen"),
      detail("w-screen"),
    ]);
  });
});

describe("findNestedCards()", () => {
  it("flags a `<Card>` opened inside a `<Card.Content>`", () => {
    const source = ["const Panel = () => (", "  <Card.Content>", "    <Card>nested</Card>", "  </Card.Content>", ");"].join("\n");

    expect(findNestedCards(source, FILE)).toEqual([
      {
        file: FILE,
        line: 3,
        ruleId: "forge-ui-no-nested-card",
        detail: "`<Card>` nested inside `<Card.Content>` — the borders compound rather than nest",
      },
    ]);
  });

  it("leaves sibling cards alone", () => {
    const source = ["<div>", "  <Card>one</Card>", "  <Card>two</Card>", "</div>"].join("\n");

    expect(findNestedCards(source, FILE)).toEqual([]);
  });

  it("leaves a `<Card.Content>` holding anything else alone", () => {
    const source = ["<Card.Content>", "  <Button>ok</Button>", "  <CardLikeThing />", "</Card.Content>"].join("\n");

    expect(findNestedCards(source, FILE)).toEqual([]);
  });

  it("leaves a card that follows the closed `<Card.Content>` alone", () => {
    const source = ["<Card.Content>text</Card.Content>", "<Card>a peer, not a child</Card>"].join("\n");

    expect(findNestedCards(source, FILE)).toEqual([]);
  });

  it("honours a suppression on the nested card's own line", () => {
    const source = [
      "<Card.Content>",
      "  /* design-allow: forge-ui-no-nested-card — the gallery renders a real card as its sample. */",
      "  <Card>nested</Card>",
      "</Card.Content>",
    ].join("\n");

    expect(findNestedCards(source, FILE)).toEqual([]);
  });
});

describe("findBareFocus()", () => {
  const detail = (hit: string): string => `\`${hit}\` styles every focus including pointer focus — use \`focus-visible:\``;

  for (const [line, hit] of [
    ['<button class="focus:ring-2" />', "focus:ring-2"],
    ["<button class='focus:outline-none' />", "focus:outline-none"],
    ['const cls = cn("focus:ring-ring/20");', "focus:ring-ring/20"],
    ['const cls = asClass("focus:bg-[#fff]");', "focus:bg-[#fff]"],
  ] as const) {
    it(`flags \`${hit}\` in ${line}`, () => {
      expect(findBareFocus(one(line), FILE)).toEqual([{ file: FILE, line: 1, ruleId: "forge-ui-interaction-focus-visible", detail: detail(hit) }]);
    });
  }

  for (const line of [
    '<button class="focus-visible:ring-2" />',
    '<div class="focus-within:ring-2" />',
    '<button class="group-focus:ring-2" />',
    "/** The tooltip appears on keyboard focus: a hint, never the only copy. */",
    'const message = "on focus: the field explains itself";',
  ]) {
    it(`leaves ${line} alone`, () => {
      expect(findBareFocus(one(line), FILE)).toEqual([]);
    });
  }

  it("reports each variant on a line once", () => {
    expect(findBareFocus(one('<button class="focus:ring-2 focus:outline-none focus:ring-2" />'), FILE).map((f) => f.detail)).toEqual([
      detail("focus:ring-2"),
      detail("focus:outline-none"),
    ]);
  });

  it("sees a class list on a continuation line of a multi-line `cn(` call", () => {
    const source = ["  class={cn(", '    "rounded-md border",', '    "focus:ring-2 focus:ring-ring",', "  )}"].join("\n");

    expect(findBareFocus(source, FILE)).toEqual([
      { file: FILE, line: 3, ruleId: "forge-ui-interaction-focus-visible", detail: detail("focus:ring-2") },
      { file: FILE, line: 3, ruleId: "forge-ui-interaction-focus-visible", detail: detail("focus:ring-ring") },
    ]);
  });

  it("leaves prose alone, because a sentence puts a space after the colon and a variant never does", () => {
    const source = ["/**", " * Shown on hover and on keyboard focus: a tooltip is a hint, never the only copy.", " */"].join("\n");

    expect(findBareFocus(source, FILE)).toEqual([]);
  });

  it("honours a suppression on the line above", () => {
    const source = [
      "/* design-allow: forge-ui-interaction-focus-visible — the sample shows what the rule forbids. */",
      '<button class="focus:ring-2" />',
    ].join("\n");

    expect(findBareFocus(source, FILE)).toEqual([]);
  });
});

describe("findRawControls()", () => {
  const SHOW = "src/ui/show/sections.tsx";
  const detail = (tag: string): string => `raw \`<${tag}>\` in the showcase — render the \`ui/core\` component the corpus points at`;

  for (const [line, tag] of [
    ["<select name='item'>", "select"], //
    ['<input type="text" />', "input"],
    ["<textarea rows='3' />", "textarea"],
    ["<button>Save</button>", "button"],
  ] as const) {
    it(`flags \`<${tag}>\` in ${line}`, () => {
      expect(findRawControls(one(line), SHOW)).toEqual([{ file: SHOW, line: 1, ruleId: "forge-ui-catalog-wrong-raw-input", detail: detail(tag) }]);
    });
  }

  for (const line of ["<Select name='item'>", "<Input />", "<Textarea />", "<Button>Save</Button>", "<inputmode />", "<selection>"]) {
    it(`leaves ${line} alone`, () => {
      expect(findRawControls(one(line), SHOW)).toEqual([]);
    });
  }

  it("flags a control whose attributes wrap onto the following lines", () => {
    const source = ["<div>", "  <select", "    name='item'", "    class='rounded-lg'>", "  </select>", "</div>"].join("\n");

    expect(findRawControls(source, SHOW)).toEqual([{ file: SHOW, line: 2, ruleId: "forge-ui-catalog-wrong-raw-input", detail: detail("select") }]);
  });

  it("leaves a file outside src/ui/show/ alone, because a primitive is where these elements belong", () => {
    expect(findRawControls(one('<input type="text" />'), "src/ui/core/input.tsx")).toEqual([]);
  });

  it("reports each tag on a line once", () => {
    expect(findRawControls(one("<button><input /><button /></button>"), SHOW).map((f) => f.detail)).toEqual([detail("button"), detail("input")]);
  });

  it("honours a suppression on the line above", () => {
    const source = [
      "/* design-allow: forge-ui-catalog-wrong-raw-input — the sample shows the unwired control it replaces. */",
      '<input type="text" />',
    ].join("\n");

    expect(findRawControls(source, SHOW)).toEqual([]);
  });
});

describe("isSuppressed()", () => {
  const marker = "/* design-allow: forge-ui-spacing-scale-only — 11px has no scale step. */";

  it("suppresses from the same line", () => {
    expect(isSuppressed([`<p class="text-[11px]" /> ${marker}`], 1, "forge-ui-spacing-scale-only")).toBe(true);
  });

  it("suppresses from the line above", () => {
    expect(isSuppressed([marker, '<p class="text-[11px]" />'], 2, "forge-ui-spacing-scale-only")).toBe(true);
  });

  it("does not reach two lines above", () => {
    expect(isSuppressed([marker, "", '<p class="text-[11px]" />'], 3, "forge-ui-spacing-scale-only")).toBe(false);
  });

  it("does not suppress a rule it does not name", () => {
    expect(isSuppressed([marker, '<p class="text-[11px]" />'], 2, "forge-ui-color-token-only")).toBe(false);
  });

  it("suppresses through the JSX expression-container form", () => {
    const jsx = "{/* design-allow: forge-ui-spacing-scale-only — no font-size step equals 11px. */}";

    expect(isSuppressed([jsx, '{hint ? <p class="text-[11px]">{hint}</p> : null}'], 2, "forge-ui-spacing-scale-only")).toBe(true);
  });

  it("does not suppress without a reason after the em dash", () => {
    expect(isSuppressed(["/* design-allow: forge-ui-spacing-scale-only — */"], 1, "forge-ui-spacing-scale-only")).toBe(false);
    expect(isSuppressed(["/* design-allow: forge-ui-spacing-scale-only */"], 1, "forge-ui-spacing-scale-only")).toBe(false);
  });

  it("does not suppress a line above the marker", () => {
    expect(isSuppressed(['<p class="text-[11px]" />', marker], 1, "forge-ui-spacing-scale-only")).toBe(false);
  });
});

describe("isValidRuleId()", () => {
  const cases: { id: string; valid: boolean }[] = [
    { id: "forge-ui-color-token-only", valid: true },
    { id: "forge-ui-no-nested-card", valid: true },
    { id: "forge-ui-a1", valid: true },
    { id: "ui-color-token-only", valid: false },
    { id: "forge-ui-Color-Token", valid: false },
    { id: "forge-ui-color-token-only.", valid: false },
    { id: "forge-ui-color_token", valid: false },
    { id: "forge-ui-color--only", valid: false },
    { id: "forge-ui-", valid: false },
    { id: "", valid: false },
  ];

  for (const { id, valid } of cases) {
    it(`${valid ? "accepts" : "rejects"} \`${id}\``, () => {
      expect(isValidRuleId(id)).toBe(valid);
    });
  }
});

describe("findRuleMarkers()", () => {
  it("reads a marker with its 1-indexed line", () => {
    const source = ["# Floor", "", "<!-- rule:forge-ui-color-token-only -->", "", "Colours resolve through tokens."].join("\n");

    expect(findRuleMarkers(source)).toEqual([{ line: 3, id: "forge-ui-color-token-only" }]);
  });

  it("reads both markers on one line, in order", () => {
    const source = ["<!-- rule:forge-ui-viewport-units --> <!-- rule:forge-ui-no-nested-card -->"].join("\n");

    expect(findRuleMarkers(source)).toEqual([
      { line: 1, id: "forge-ui-viewport-units" },
      { line: 1, id: "forge-ui-no-nested-card" },
    ]);
  });

  it("tolerates whitespace around the id", () => {
    expect(findRuleMarkers("<!--   rule:  forge-ui-no-inline-style   -->")).toEqual([{ line: 1, id: "forge-ui-no-inline-style" }]);
  });

  it("reports a malformed id rather than skipping it, so the grammar check can see it", () => {
    const markers = findRuleMarkers("<!-- rule:forge-ui-Bad. -->");

    expect(markers).toEqual([{ line: 1, id: "forge-ui-Bad." }]);
    expect(isValidRuleId(markers[0]?.id ?? "")).toBe(false);
  });

  it("finds no marker in prose that merely mentions one", () => {
    expect(findRuleMarkers("Each rule carries a `rule:` marker.")).toEqual([]);
  });
});

describe("findRuleCitations()", () => {
  it("reads a backticked bare id", () => {
    const source = ["| Check | Rule |", "| Colours | `forge-ui-color-token-only` |"].join("\n");

    expect(findRuleCitations(source)).toEqual([{ line: 2, id: "forge-ui-color-token-only" }]);
  });

  it("reads both citations on one line", () => {
    expect(findRuleCitations("`forge-ui-viewport-units` and `forge-ui-no-nested-card`")).toEqual([
      { line: 1, id: "forge-ui-viewport-units" },
      { line: 1, id: "forge-ui-no-nested-card" },
    ]);
  });

  it("ignores an unbackticked id, which is prose rather than a citation", () => {
    expect(findRuleCitations("The rule forge-ui-viewport-units applies here.")).toEqual([]);
  });

  it("ignores a definition marker, which is never in a code span", () => {
    expect(findRuleCitations("<!-- rule:forge-ui-viewport-units -->")).toEqual([]);
  });
});

const PKG = "@y-core/forge";

describe("findBarrelImports()", () => {
  it("reads a single-line named import", () => {
    expect(findBarrelImports('import { Button, Card } from "@y-core/forge/ui/core";', PKG)).toEqual([
      { line: 1, subpath: "./ui/core", symbols: ["Button", "Card"] },
    ]);
  });

  it("reads a multi-line import as one citation, reported on its first line", () => {
    const source = ["```ts", "import {", "  Button,", "  Card,", '} from "@y-core/forge/ui/core";', "```"].join("\n");

    expect(findBarrelImports(source, PKG)).toEqual([{ line: 2, subpath: "./ui/core", symbols: ["Button", "Card"] }]);
  });

  it("strips a statement-level `type` marker", () => {
    expect(findBarrelImports('import type { FC, PropsWithChildren } from "@y-core/forge/jsx";', PKG)).toEqual([
      { line: 1, subpath: "./jsx", symbols: ["FC", "PropsWithChildren"] },
    ]);
  });

  it("strips a specifier-level `type` marker", () => {
    expect(findBarrelImports('import { type FC, jsx } from "@y-core/forge/jsx";', PKG)).toEqual([
      { line: 1, subpath: "./jsx", symbols: ["FC", "jsx"] },
    ]);
  });

  it("resolves an `as` alias back to the exported name", () => {
    expect(findBarrelImports('import { Button as Btn } from "@y-core/forge/ui/core";', PKG)).toEqual([
      { line: 1, subpath: "./ui/core", symbols: ["Button"] },
    ]);
  });

  it("ignores an import from another package", () => {
    expect(findBarrelImports('import * as v from "valibot";\nimport { object } from "valibot";', PKG)).toEqual([]);
  });

  it("ignores the bare package name, which names no barrel", () => {
    expect(findBarrelImports('import { forge } from "@y-core/forge";', PKG)).toEqual([]);
  });

  it("ignores an empty brace group", () => {
    expect(findBarrelImports('import {} from "@y-core/forge/ui/core";', PKG)).toEqual([]);
  });

  it("reads every import in a document, in source order", () => {
    const source = [
      'import { Button } from "@y-core/forge/ui/core";',
      'import { z } from "zod";',
      'import { fakeKV } from "@y-core/forge/testing";',
    ].join("\n");

    expect(findBarrelImports(source, PKG)).toEqual([
      { line: 1, subpath: "./ui/core", symbols: ["Button"] },
      { line: 3, subpath: "./testing", symbols: ["fakeKV"] },
    ]);
  });
});

describe("findCustomPropertyCitations()", () => {
  it("reads an exact citation", () => {
    expect(findCustomPropertyCitations("Text uses `--muted-foreground`.")).toEqual([{ line: 1, property: "--muted-foreground", family: false }]);
  });

  it("reads a family citation as its prefix", () => {
    expect(findCustomPropertyCitations("The `--palette-*` ramp.")).toEqual([{ line: 1, property: "--palette", family: true }]);
  });

  it("does not also emit a bare citation for the family's own prefix", () => {
    expect(findCustomPropertyCitations("`--palette-*`").filter((c) => !c.family)).toEqual([]);
  });

  it("blanks a family match without shifting the lines after it", () => {
    const source = ["# Tokens", "The `--palette-*` ramp and `--background`.", "Then `--widget-*`.", "And `--ring`."].join("\n");

    expect(findCustomPropertyCitations(source)).toEqual([
      { line: 2, property: "--palette", family: true },
      { line: 2, property: "--background", family: false },
      { line: 3, property: "--widget", family: true },
      { line: 4, property: "--ring", family: false },
    ]);
  });

  it("stops the range form at the ellipsis, yielding a real property", () => {
    expect(findCustomPropertyCitations("The stops `--palette-50…950` are per-theme.")).toEqual([
      { line: 1, property: "--palette-50", family: false },
    ]);
  });

  it("reads several citations on one line, families first then bare tokens", () => {
    expect(findCustomPropertyCitations("`--palette-*` pairs with `--background` and `--foreground`.")).toEqual([
      { line: 1, property: "--palette", family: true },
      { line: 1, property: "--background", family: false },
      { line: 1, property: "--foreground", family: false },
    ]);
  });

  it("finds nothing in a markdown rule or a double hyphen in prose", () => {
    expect(findCustomPropertyCitations("---")).toEqual([]);
    expect(findCustomPropertyCitations("a -- b")).toEqual([]);
    expect(findCustomPropertyCitations("`--PALETTE-*`")).toEqual([]);
  });
});

describe("parseDeclaredCustomProperties()", () => {
  const css = [
    ":root {",
    "  --background: oklch(1 0 0);",
    "  --muted-foreground: var(--palette-500);",
    "}",
    ".dark {",
    "  --background: oklch(0.2 0 0);",
    "  --palette-50: #f8fafc;",
    "}",
    ".card { color: var(--ring); }",
  ].join("\n");

  it("collects every declared property across every block, deduplicated", () => {
    expect([...parseDeclaredCustomProperties(css)].sort()).toEqual(["--background", "--muted-foreground", "--palette-50"]);
  });

  it("does not collect a `var()` usage as a declaration", () => {
    const declared = parseDeclaredCustomProperties(css);

    expect(declared.has("--palette-500")).toBe(false);
    expect(declared.has("--ring")).toBe(false);
  });

  it("returns an empty set for a stylesheet that declares none", () => {
    expect([...parseDeclaredCustomProperties(".card { color: var(--ring); }")]).toEqual([]);
  });
});

describe("findSourceViolations()", () => {
  it("returns every check's findings, sorted by line then rule id", () => {
    const source = [
      '<div class="h-screen">',
      '  <span class="text-[13px]" />',
      '  <b class="bg-[#fff]" />',
      '  <i style="color: red" />',
      "</div>",
    ].join("\n");

    expect(findSourceViolations(source, FILE)).toEqual([
      { file: FILE, line: 1, ruleId: "forge-ui-viewport-units", detail: "`h-screen` measures the layout viewport — use `min-h-dvh`" },
      { file: FILE, line: 2, ruleId: "forge-ui-spacing-scale-only", detail: "arbitrary value `text-[13px]` where a scale value exists" },
      {
        file: FILE,
        line: 3,
        ruleId: "forge-ui-color-token-only",
        detail: "raw colour literal `#fff` in a class string — resolve the colour through a semantic token",
      },
      { file: FILE, line: 3, ruleId: "forge-ui-spacing-scale-only", detail: "arbitrary value `bg-[#fff]` where a scale value exists" },
      {
        file: FILE,
        line: 4,
        ruleId: "forge-ui-no-inline-style",
        detail: "`style=` attribute — the renderer drops it; express the rule as a class",
      },
    ]);
  });

  it("returns nothing for a file that violates none of the rules", () => {
    const source = [
      "const Card = () => (",
      "  <div class={cn('min-h-dvh bg-card p-4 text-sm text-card-foreground', 'max-h-[60vh]')}>",
      "    <Card.Content>",
      "      <Button class='bg-red-50 dark:bg-red-950 data-[open]:block'>ok</Button>",
      "    </Card.Content>",
      "  </div>",
      ");",
    ].join("\n");

    expect(findSourceViolations(source, FILE)).toEqual([]);
  });

  it("includes the theme check, sorted in beside the colour-literal one it does not overlap", () => {
    expect(findSourceViolations(one('<div class="bg-[#fff] bg-yellow-100" />'), FILE).map((f) => f.ruleId)).toEqual([
      "forge-ui-color-theme-no-raw-utility",
      "forge-ui-color-token-only",
      "forge-ui-spacing-scale-only",
    ]);
  });
});

describe("formatDesignFinding()", () => {
  it("renders the file, line, rule id, detail and corpus path", () => {
    const finding: DesignFinding = {
      file: "src/ui/core/card.tsx",
      line: 12,
      ruleId: "forge-ui-no-nested-card",
      detail: "`<Card>` nested inside `<Card.Content>` — the borders compound rather than nest",
    };

    expect(formatDesignFinding(finding)).toBe(
      "src/ui/core/card.tsx:12: forge-ui-no-nested-card — `<Card>` nested inside `<Card.Content>` — the borders compound rather than nest (src/ui/design/floor.md)",
    );
  });

  it("routes each rule to its own corpus path", () => {
    const finding: DesignFinding = { file: "a.tsx", line: 1, ruleId: "forge-ui-viewport-units", detail: "d" };

    expect(formatDesignFinding(finding)).toBe("a.tsx:1: forge-ui-viewport-units — d (src/ui/design/floor.md)");
  });
});

describe("RULE_CORPUS_PATH", () => {
  const ids: RuleId[] = [
    "forge-ui-color-token-only",
    "forge-ui-color-theme-no-raw-utility",
    "forge-ui-no-inline-style",
    "forge-ui-spacing-scale-only",
    "forge-ui-viewport-units",
    "forge-ui-no-nested-card",
    "forge-ui-interaction-focus-visible",
    "forge-ui-catalog-wrong-raw-input",
    "forge-ui-contrast-floor",
  ];

  it("carries exactly the enforced rules", () => {
    expect(Object.keys(RULE_CORPUS_PATH).sort()).toEqual([...ids].sort());
  });

  it("routes every rule to a file that exists under src/ui/design/", () => {
    const missing = Object.entries(RULE_CORPUS_PATH).filter(([, path]) => !path.startsWith("src/ui/design/") || !existsSync(resolve(ROOT, path)));

    expect(missing).toEqual([]);
  });

  it("names a well-formed id for every key", () => {
    expect(Object.keys(RULE_CORPUS_PATH).filter((id) => !isValidRuleId(id))).toEqual([]);
  });
});
