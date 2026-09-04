import { describe, expect, it } from "bun:test";

import {
  blankComments,
  findAspectRatioPadding,
  findCssBlocks,
  findDensityQueries,
  findDuplicatedColorScheme,
  findModernCssViolations,
  findNegativeZIndex,
  findPhysicalSpacing,
  findPrefixedLineClamp,
  findTranslateCentering,
  findWebkitScrollbar,
  isModernCssSuppressed,
} from "./modern-css-parse";

const CSS = "src/ui/assets/css/fixture.css";

describe("blankComments()", () => {
  it("replaces the comment body with spaces and keeps the length", () => {
    expect(blankComments("a /* hi */ b")).toBe("a          b");
  });

  it("keeps the newlines inside a multi-line comment", () => {
    expect(blankComments("a\n/* one\ntwo */\nb").split("\n")).toEqual(["a", "      ", "      ", "b"]);
  });
});

describe("findCssBlocks()", () => {
  it("returns the declaration block and not the at-rule around it", () => {
    const blocks = findCssBlocks("@media (min-width: 40rem) { .a { color: red; } }");

    expect(blocks.map((block) => block.prelude)).toEqual([".a"]);
    expect(blocks.map((block) => block.ancestors)).toEqual([["@media (min-width: 40rem)"]]);
  });

  it("collapses whitespace inside a multi-line selector list", () => {
    expect(findCssBlocks(".a,\n  .b {\n  color: red;\n}").map((block) => block.prelude)).toEqual([".a, .b"]);
  });
});

describe("isModernCssSuppressed()", () => {
  const lines = [
    "/* modern-css-allow: forge-ui-platform-isolation — the layer is behind an ancestor on purpose */",
    "  z-index: -1;",
    "  z-index: -2;",
    "/* modern-css-allow: forge-ui-platform-isolation */",
    "  z-index: -3;",
  ];

  it("suppresses the line below the marker", () => {
    expect(isModernCssSuppressed(lines, 2, "forge-ui-platform-isolation")).toBe(true);
  });

  it("does not reach a second line below the marker", () => {
    expect(isModernCssSuppressed(lines, 3, "forge-ui-platform-isolation")).toBe(false);
  });

  it("refuses a marker that carries no reason", () => {
    expect(isModernCssSuppressed(lines, 5, "forge-ui-platform-isolation")).toBe(false);
  });

  it("does not let one rule's marker suppress another rule", () => {
    expect(isModernCssSuppressed(lines, 2, "forge-ui-platform-scrollbar")).toBe(false);
  });
});

describe("findAspectRatioPadding()", () => {
  it("flags percentage bottom padding inside a relative rule", () => {
    const source = ".frame {\n  position: relative;\n  padding-bottom: 56.25%;\n}";

    expect(findAspectRatioPadding(source, CSS)).toEqual([
      {
        file: CSS,
        line: 3,
        ruleId: "forge-ui-platform-aspect-ratio",
        detail: "`padding-bottom: 56.25%` in a `position: relative` rule reserves a ratio box — declare it with `aspect-ratio`",
      },
    ]);
  });

  it("does not flag percentage padding outside a relative rule", () => {
    expect(findAspectRatioPadding(".frame {\n  padding-bottom: 56.25%;\n}", CSS)).toEqual([]);
  });

  it("does not flag a length", () => {
    expect(findAspectRatioPadding(".frame {\n  position: relative;\n  padding-bottom: 1rem;\n}", CSS)).toEqual([]);
  });
});

describe("findTranslateCentering()", () => {
  it("flags the offset-and-translate idiom", () => {
    const source = ".mid {\n  position: absolute;\n  top: 50%;\n  left: 50%;\n  transform: translate(-50%, -50%);\n}";

    expect(findTranslateCentering(source, CSS)).toEqual([
      {
        file: CSS,
        line: 5,
        ruleId: "forge-ui-platform-centering",
        detail: "`top: 50%` and `left: 50%` pulled back by `translate(-50%, -50%)` — centre the child with `place-items: center` on the container",
      },
    ]);
  });

  it("does not flag a translate that only moves one axis", () => {
    expect(findTranslateCentering(".mid {\n  top: 50%;\n  left: 50%;\n  translate: -50% 0;\n}", CSS)).toEqual([]);
  });

  it("does not flag the idiom split across two rules", () => {
    expect(findTranslateCentering(".a {\n  top: 50%;\n  left: 50%;\n}\n.b {\n  transform: translate(-50%, -50%);\n}", CSS)).toEqual([]);
  });
});

describe("findDensityQueries()", () => {
  it("flags a min-resolution query", () => {
    expect(findDensityQueries("@media (min-resolution: 2dppx) {\n  .a { background: url(a@2x.png); }\n}", CSS)).toEqual([
      {
        file: CSS,
        line: 1,
        ruleId: "forge-ui-platform-image-set",
        detail: "`min-resolution` selects an image by device density — declare the variants with `image-set()`",
      },
    ]);
  });

  it("flags the prefixed pixel-ratio spelling", () => {
    expect(findDensityQueries("@media (-webkit-min-device-pixel-ratio: 2) { .a { color: red; } }", CSS).map((f) => f.detail)).toEqual([
      "`-webkit-min-device-pixel-ratio` selects an image by device density — declare the variants with `image-set()`",
    ]);
  });
});

describe("findNegativeZIndex()", () => {
  it("flags a negative z-index and quotes it", () => {
    expect(findNegativeZIndex(".glow {\n  z-index: -1;\n}", CSS)).toEqual([
      {
        file: CSS,
        line: 2,
        ruleId: "forge-ui-platform-isolation",
        detail: "`z-index: -1` escapes the parent's paint order — create a stacking context with `isolation: isolate`",
      },
    ]);
  });

  it("does not flag a non-negative z-index", () => {
    expect(findNegativeZIndex(".glow {\n  z-index: 10;\n}", CSS)).toEqual([]);
  });
});

describe("findPrefixedLineClamp()", () => {
  it("flags each prefixed property once per line", () => {
    const source = ".clamp {\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n}";

    expect(findPrefixedLineClamp(source, CSS).map((f) => `${f.line}:${f.detail}`)).toEqual([
      "2:`-webkit-line-clamp` is a prefixed property tied to `display: -webkit-box` — clamp with `line-clamp`",
      "3:`-webkit-box-orient` is a prefixed property tied to `display: -webkit-box` — clamp with `line-clamp`",
    ]);
  });
});

describe("findWebkitScrollbar()", () => {
  it("flags the pseudo-element as written", () => {
    expect(findWebkitScrollbar(".pane::-webkit-scrollbar-thumb {\n  background: red;\n}", CSS)).toEqual([
      {
        file: CSS,
        line: 1,
        ruleId: "forge-ui-platform-scrollbar",
        detail: "`::-webkit-scrollbar-thumb` is a non-standard pseudo-element — style the scrollbar with `scrollbar-color` and `scrollbar-width`",
      },
    ]);
  });

  it("does not flag the standard properties", () => {
    expect(findWebkitScrollbar(".pane {\n  scrollbar-width: thin;\n}", CSS)).toEqual([]);
  });
});

describe("findDuplicatedColorScheme()", () => {
  it("flags a selector redeclared under the media query", () => {
    const source = ":root {\n  --bg: white;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n    --bg: black;\n  }\n}";

    expect(findDuplicatedColorScheme(source, CSS)).toEqual([
      {
        file: CSS,
        line: 5,
        ruleId: "forge-ui-platform-light-dark",
        detail: "`:root` is declared again under `prefers-color-scheme` — express the per-mode value with `light-dark()`",
      },
    ]);
  });

  it("does not flag a selector the media query alone declares", () => {
    expect(findDuplicatedColorScheme("@media (prefers-color-scheme: dark) {\n  .only-here {\n    color: red;\n  }\n}", CSS)).toEqual([]);
  });

  it("does not flag a light-dark() declaration", () => {
    expect(findDuplicatedColorScheme(":root {\n  --bg: light-dark(white, black);\n}", CSS)).toEqual([]);
  });
});

describe("findPhysicalSpacing() — stylesheets", () => {
  it("flags a physical inline margin", () => {
    expect(findPhysicalSpacing(".a {\n  margin-left: 1rem;\n}", CSS)).toEqual([
      { file: CSS, line: 2, ruleId: "forge-ui-platform-logical-spacing", detail: "physical property `margin-left` — use `margin-inline-start`" },
    ]);
  });

  it("flags a physical inset", () => {
    expect(findPhysicalSpacing(".a {\n  right: 0;\n}", CSS).map((f) => f.detail)).toEqual(["physical property `right` — use `inset-inline-end`"]);
  });

  it("does not flag an inset resolved against anchor()", () => {
    expect(findPhysicalSpacing(".a {\n  left: anchor(right);\n}", CSS)).toEqual([]);
  });

  it("does not flag the block axis, which no direction mirrors", () => {
    expect(findPhysicalSpacing(".a {\n  margin-top: 1rem;\n  padding-bottom: 1rem;\n  top: 0;\n}", CSS)).toEqual([]);
  });

  it("does not flag a physical keyword in a value", () => {
    expect(findPhysicalSpacing(".a {\n  text-align: left;\n  float: right;\n  background-position: left top;\n}", CSS)).toEqual([]);
  });

  it("does not flag border-left, which the rule does not cover", () => {
    expect(findPhysicalSpacing(".a {\n  border-left: 1px solid red;\n}", CSS)).toEqual([]);
  });

  it("honours a suppression marker on the line above", () => {
    const source =
      ".a {\n  /* modern-css-allow: forge-ui-platform-logical-spacing — the caller asked for a physical side */\n  margin-left: 1rem;\n}";

    expect(findPhysicalSpacing(source, CSS)).toEqual([]);
  });
});

describe("findModernCssViolations()", () => {
  it("orders by line, then by rule id", () => {
    const source = [".pane::-webkit-scrollbar {", "  width: 4px;", "}", ".a {", "  margin-left: 1rem; z-index: -1;", "}"].join("\n");

    expect(findModernCssViolations(source, CSS).map((f) => `${f.line} ${f.ruleId}`)).toEqual([
      "1 forge-ui-platform-scrollbar",
      "5 forge-ui-platform-isolation",
      "5 forge-ui-platform-logical-spacing",
    ]);
  });

  it("finds nothing in a stylesheet that already uses the platform features", () => {
    const source = [
      ":root {",
      "  --bg: light-dark(white, black);",
      "}",
      ".frame {",
      "  aspect-ratio: 16 / 9;",
      "  isolation: isolate;",
      "  margin-inline-start: 1rem;",
      "  scrollbar-width: thin;",
      "  line-clamp: 2;",
      "  place-items: center;",
      "}",
    ].join("\n");

    expect(findModernCssViolations(source, CSS)).toEqual([]);
  });

  it("does not flag a 50% alpha colour-mix used for a focus ring", () => {
    expect(findModernCssViolations(".a:focus-visible {\n  outline-color: color-mix(in oklch, var(--ring) 50%, transparent);\n}", CSS)).toEqual([]);
  });
});
