import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderGfmCorpus } from "../../../render/markdown/gfm-corpus.fixture";
import { MARKDOWN_ELEMENTS } from "../../../render/markdown/mod";
import { findCssBlocks } from "../../../tooling/gate/checks/modern-css-parse";
import { blankComments } from "../../../tooling/gate/checks/source-scan";

const SHEET = blankComments(readFileSync(fileURLToPath(new URL("./markdown.css", import.meta.url)), "utf-8"));
const BLOCKS = findCssBlocks(SHEET);
const RULES = BLOCKS.filter((block) => !block.prelude.startsWith("@"));
const CORPUS = renderGfmCorpus({ elements: MARKDOWN_ELEMENTS, url: ({ value }) => value });

const BOXLESS_ELEMENTS = new Set(["br"]);
const UNSTYLED_ATTRIBUTES = new Set([
  "alt",
  "aria-describedby",
  "aria-label",
  "checked",
  "class",
  "data-footnote-backref",
  "data-line",
  "disabled",
  "href",
  "id",
  "name",
  "rel",
  "src",
  "start",
  "title",
  "type",
  "value",
]);

interface Inventory {
  elements: Set<string>;
  classes: Set<string>;
  attributes: Set<string>;
}

function whereArguments(prelude: string): string[] | null {
  if (!prelude.startsWith(":where(") || !prelude.endsWith(")")) return null;
  const inner = prelude.slice(":where(".length, -1);
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") {
      depth--;
      if (depth < 0) return null;
    } else if (char === "," && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth !== 0) return null;
  args.push(inner.slice(start).trim());
  return args;
}

function selectorInventory(preludes: readonly string[]): Inventory {
  const inventory: Inventory = { elements: new Set(), classes: new Set(), attributes: new Set() };
  for (const prelude of preludes) {
    for (const [, name] of prelude.matchAll(/\.([A-Za-z_][\w-]*)/g)) if (name) inventory.classes.add(name);
    for (const [, name] of prelude.matchAll(/\[([a-z][\w-]*)/g)) if (name) inventory.attributes.add(name);
    if (/\[class[*^]="language-"\]/.test(prelude)) inventory.classes.add("language-*");
    for (const [, name] of prelude.replace(/\[[^\]]*\]/g, "").matchAll(/(?:^|[\s>+~(,])([a-z][a-z0-9]*)/g)) if (name) inventory.elements.add(name);
  }
  return inventory;
}

function markupInventory(html: readonly string[]): Inventory {
  const inventory: Inventory = { elements: new Set(), classes: new Set(), attributes: new Set() };
  for (const document of html) {
    for (const [, tag, attributes] of document.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)) {
      if (tag) inventory.elements.add(tag);
      for (const [, name, value] of (attributes ?? "").matchAll(/\s([a-z][\w:-]*)(?:="([^"]*)")?/g)) {
        if (!name) continue;
        inventory.attributes.add(name);
        if (name !== "class") continue;
        for (const token of (value ?? "").split(/\s+/).filter(Boolean)) inventory.classes.add(token.startsWith("language-") ? "language-*" : token);
      }
    }
  }
  return inventory;
}

const SELECTORS = selectorInventory(RULES.map((rule) => rule.prelude));
const MARKUP = markupInventory(CORPUS);

describe("markdown.css covers what the default handlers write", () => {
  test("the corpus renders the task, footnote, code-language and alignment markup the sheet has to reach", () => {
    const expected = {
      elements: ["label", "input", "section", "sup"],
      classes: ["sr-only", "task-list-item", "contains-task-list", "footnotes", "data-footnote-backref", "language-*"],
      attributes: ["align", "data-footnote-ref", "data-footnotes"],
    };

    expect({
      elements: expected.elements.filter((name) => MARKUP.elements.has(name)),
      classes: expected.classes.filter((name) => MARKUP.classes.has(name)),
      attributes: expected.attributes.filter((name) => MARKUP.attributes.has(name)),
    }).toEqual(expected);
  });

  test("every element the corpus renders, bar the boxless ones, is named by a selector", () => {
    expect([...MARKUP.elements].filter((name) => !BOXLESS_ELEMENTS.has(name) && !SELECTORS.elements.has(name))).toEqual([]);
  });

  test("every class the corpus renders is named by a selector", () => {
    expect([...MARKUP.classes].filter((name) => !SELECTORS.classes.has(name))).toEqual([]);
  });

  test("every attribute the corpus renders that carries presentation is named by a selector", () => {
    expect([...MARKUP.attributes].filter((name) => !UNSTYLED_ATTRIBUTES.has(name) && !SELECTORS.attributes.has(name))).toEqual([]);
  });
});

describe("markdown.css never outranks an app rule", () => {
  test("every rule is a single :where() whose every selector is rooted at .markdown", () => {
    const outranking = RULES.filter((rule) => {
      const args = whereArguments(rule.prelude);
      return args === null || !args.every((arg) => /^\.markdown(?=$|[\s>])/.test(arg));
    }).map((rule) => rule.prelude);

    expect({ rules: RULES.length > 0, outranking }).toEqual({ rules: true, outranking: [] });
  });

  test("no rule sits in a layer, and the sheet imports none", () => {
    expect({
      statements: SHEET.match(/@(?:layer|import)\b/g) ?? [],
      layered: BLOCKS.filter((block) => block.ancestors.some((ancestor) => ancestor.startsWith("@layer"))).map((block) => block.prelude),
    }).toEqual({ statements: [], layered: [] });
  });

  test("no declaration is !important, no rule is nested in another, and no selector reaches a pseudo-element", () => {
    expect({
      important: SHEET.match(/!\s*important/g) ?? [],
      nested: RULES.filter((rule) => rule.ancestors.some((ancestor) => !ancestor.startsWith("@"))).map((rule) => rule.prelude),
      pseudoElements: RULES.filter((rule) => rule.prelude.includes("::")).map((rule) => rule.prelude),
    }).toEqual({ important: [], nested: [], pseudoElements: [] });
  });

  test("the sheet holds no Tailwind directive, so it loads as plain CSS", () => {
    expect(SHEET.match(/@(?:apply|theme|utility|source|custom-variant|variant|plugin|config|tailwind|reference)\b/g) ?? []).toEqual([]);
  });
});

describe("markdown.css tokens", () => {
  test("every var() is a --markdown-* property falling back to one theme variable", () => {
    const vars = SHEET.match(/var\(/g)?.length ?? 0;
    const tokens = SHEET.match(/var\(--markdown-[a-z-]+, var\(--[a-z0-9-]+\)\)/g)?.length ?? 0;

    expect({ tokens: tokens > 0, vars }).toEqual({ tokens: true, vars: tokens * 2 });
  });

  test("the sheet declares no --markdown-* property, leaving every one to the app", () => {
    expect(SHEET.match(/--markdown-[\w-]+\s*:/g) ?? []).toEqual([]);
  });
});
