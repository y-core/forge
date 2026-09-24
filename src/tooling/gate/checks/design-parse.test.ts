import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findBarrelImports,
  findClassLiterals,
  findCustomPropertyCitations,
  findRuleCitations,
  findRuleMarkers,
  findSkippedClassPositions,
  isValidRuleId,
  parseDeclaredCustomProperties,
} from "./design-parse";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

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
    const source = ["<!-- rule:forge-ui-focus-ring --> <!-- rule:forge-ui-no-nested-card -->"].join("\n");

    expect(findRuleMarkers(source)).toEqual([
      { line: 1, id: "forge-ui-focus-ring" },
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
    expect(findRuleCitations("`forge-ui-focus-ring` and `forge-ui-no-nested-card`")).toEqual([
      { line: 1, id: "forge-ui-focus-ring" },
      { line: 1, id: "forge-ui-no-nested-card" },
    ]);
  });

  it("ignores an unbackticked id, which is prose rather than a citation", () => {
    expect(findRuleCitations("The rule forge-ui-focus-ring applies here.")).toEqual([]);
  });

  it("ignores a definition marker, which is never in a code span", () => {
    expect(findRuleCitations("<!-- rule:forge-ui-focus-ring -->")).toEqual([]);
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

describe("findClassLiterals() — every class position the formatter sorts", () => {
  const harvested: { source: string; literals: { line: number; text: string }[]; label: string }[] = [
    { source: '<div class="p-4 flex" />', literals: [{ line: 1, text: "p-4 flex" }], label: "a quoted attribute" },
    { source: '<div class={"p-4 flex"} />', literals: [{ line: 1, text: "p-4 flex" }], label: "a string in an expression container" },
    {
      source: "<div class={`a ${x} b`} />",
      literals: [
        { line: 1, text: "a " },
        { line: 1, text: " b" },
      ],
      label: "a template, one literal per interpolation-delimited chunk",
    },
    {
      source: '<div class={c ? "x" : "y"} />',
      literals: [
        { line: 1, text: "x" },
        { line: 1, text: "y" },
      ],
      label: "both branches of a ternary",
    },
    {
      source: '<div class={cn("a", "b")} />',
      literals: [
        { line: 1, text: "a" },
        { line: 1, text: "b" },
      ],
      label: "a `cn` call inside a container, reached once rather than twice",
    },
    {
      source: '<div class={`x ${cn("p-4 flex")} y`} />',
      literals: [
        { line: 1, text: "x " },
        { line: 1, text: " y" },
        { line: 1, text: "p-4 flex" },
      ],
      label: "a call inside an interpolation, beside the chunks around it",
    },
    {
      source: 'const a = cn("a(b)", "c");',
      literals: [
        { line: 1, text: "a(b)" },
        { line: 1, text: "c" },
      ],
      label: "a paren inside a string",
    },
    { source: 'const a = cn("a " + "b");', literals: [{ line: 1, text: "a b" }], label: "a `+`-joined pair, judged joined" },
    {
      source: 'const a = cva({\n  base: "p-4 flex",\n});',
      literals: [{ line: 2, text: "p-4 flex" }],
      label: "a `cva` variant map, at its own line",
    },
  ];

  for (const { source, literals, label } of harvested) {
    it(`harvests ${label}`, () => {
      expect(findClassLiterals(source)).toEqual(literals);
    });
  }

  describe("a trailing // comment beside a class position", () => {
    const literals = [
      { line: 2, text: "px-2 px-4" },
      { line: 3, text: "py-2 py-4" },
    ];

    it("harvests both literals past a comment holding an apostrophe", () => {
      const source = ["const a = cn(", `  "px-2 px-4", // don't reorder`, '  "py-2 py-4",', ");"].join("\n");

      expect(findClassLiterals(source)).toEqual(literals);
    });

    it("harvests both literals past a comment holding a URL", () => {
      const source = ["const a = cn(", '  "px-2 px-4", // see https://x.test/y', '  "py-2 py-4",', ");"].join("\n");

      expect(findClassLiterals(source)).toEqual(literals);
    });
  });

  describe("the constructs it must not flag", () => {
    const ignored: { source: string; label: string }[] = [
      { source: "<div class={IDENT} />", label: "an identifier-valued container" },
      { source: '  // <div class="flex flex" />', label: "a commented-out literal" },
      { source: '  // const a = cn("flex flex");', label: "a commented-out call" },
      { source: 'const a = cn("a", "b";', label: "an unbalanced call span" },
      { source: "<div class={`${A} ${B}`} />", label: "whitespace-only template chunks" },
      { source: '<div data-x="p-4 flex" />', label: "an attribute the formatter does not sort" },
    ];

    for (const { source, label } of ignored) {
      it(`harvests nothing from ${label}`, () => {
        expect(findClassLiterals(source)).toEqual([]);
      });
    }

    it("harvests nothing from its own source, whose comments name every class position", () => {
      const own = readFileSync(resolve(ROOT, "src/tooling/gate/checks/design-parse.ts"), "utf-8");

      expect(findClassLiterals(own)).toEqual([]);
    });
  });
});

describe("findSkippedClassPositions() — what the scan dropped unread", () => {
  it("reports the position whose span never closes", () => {
    expect(findSkippedClassPositions('const a = cn("a", "b";')).toEqual([{ line: 1, text: "cn(" }]);
  });

  it("reports the line the dropped position sits on", () => {
    const source = ["const a = 1;", 'const b = cn("x", "y";'].join("\n");

    expect(findSkippedClassPositions(source)).toEqual([{ line: 2, text: "cn(" }]);
  });

  it("reports nothing for a position a trailing comment used to break", () => {
    const source = ["const a = cn(", `  "px-2 px-4", // don't reorder`, '  "py-2 py-4",', ");"].join("\n");

    expect(findSkippedClassPositions(source)).toEqual([]);
  });

  it("reports nothing for a well-formed call", () => {
    expect(findSkippedClassPositions('const a = cn("a", "b");')).toEqual([]);
  });
});
