import { describe, expect, test } from "bun:test";

import gfm from "../../../tests/fixtures/markdown/gfm.json";
import spec from "../../../tests/fixtures/markdown/spec.json";
import { CRUCIBLE_RENDER_OPTIONS, CRUCIBLE_SCHEMA, STARTER_SCHEMA } from "./consumer-schemas.fixture";
import { parseMarkdown } from "./document";
import { GFM_TASK_LISTS } from "./gfm-task-lists.fixture";
import { renderMarkdownHtml } from "./html";
import { MARKDOWN_ELEMENTS } from "./html-schema";
import type { ElementRule, HtmlSchema, MarkdownDocument, MarkdownRenderOptions } from "./types";

const SOURCES: readonly string[] = [
  ...spec.examples.map(({ markdown }) => markdown),
  ...gfm.examples.map(({ markdown }) => markdown),
  ...GFM_TASK_LISTS.map(({ markdown }) => markdown),
  "a[^1] b[^1]\n\n[^1]: note\n",
  "x[^n]\n\n[^n]: - [x] a\n",
  "| a | b | c |\n|:-|:-:|-:|\n| 1 |\n",
  "```ts\nx\n```\n",
  "1. [x] t\n\n# h\n\n###### six\n\n---\n\n> q\n\n3. o\n\n    ind\n",
];

const OPTION_SETS: readonly Omit<MarkdownRenderOptions, "schema">[] = [
  {},
  { lineAnchors: true, tasks: { name: "task" }, links: { rel: "nofollow" }, footnotes: { emptyFlagValues: true } },
  {
    lineAnchors: true,
    headingOffset: 1,
    breaks: true,
    tasks: { name: "t", disabled: true },
    classNames: { "task-list-item": "todo", footnotes: null },
  },
];

const DOCUMENTS: readonly MarkdownDocument[] = SOURCES.map((source) => parseMarkdown(source));
const PRESET_SCHEMA: HtmlSchema = { elements: MARKDOWN_ELEMENTS, url: ({ value }) => value };

function createRecordingSchema(written: Map<string, Set<string>>): HtmlSchema {
  const ruleFor = (tag: string): ElementRule => {
    const names = written.get(tag) ?? new Set<string>();
    written.set(tag, names);
    const attributes = { includes: (name: string) => (names.add(name), true) } as unknown as readonly string[];
    return { attributes };
  };
  const elements = new Proxy({} as Record<string, ElementRule>, { get: (_target, tag) => (typeof tag === "string" ? ruleFor(tag) : undefined) });
  return { elements, url: ({ value }) => value };
}

function sortedAttributes(entries: Iterable<[string, Iterable<string>]>): Record<string, string[]> {
  return Object.fromEntries(
    [...entries].map(([tag, names]): [string, string[]] => [tag, [...names].toSorted()]).toSorted(([a], [b]) => a.localeCompare(b)),
  );
}

const written = new Map<string, Set<string>>();
const RECORDING_SCHEMA = createRecordingSchema(written);
const RENDERS = OPTION_SETS.flatMap((options) =>
  DOCUMENTS.map((document) => ({
    preset: renderMarkdownHtml(document, { ...options, schema: PRESET_SCHEMA }),
    permissive: renderMarkdownHtml(document, { ...options, schema: RECORDING_SCHEMA }),
  })),
);

describe("MARKDOWN_ELEMENTS", () => {
  test("renders every fixture under every option set exactly as a schema allowing everything does", () => {
    const differing = RENDERS.filter(({ preset, permissive }) => preset !== permissive);
    expect(differing).toEqual([]);
    expect(RENDERS).toHaveLength(OPTION_SETS.length * SOURCES.length);
  });

  test("allows exactly the elements and attributes the default handlers write, no more and no fewer", () => {
    const allowed = Object.entries(MARKDOWN_ELEMENTS).map(([tag, rule]): [string, readonly string[]] => [tag, rule.attributes ?? []]);
    expect(sortedAttributes(written)).toEqual(sortedAttributes(allowed));
  });

  test("allows no style element or attribute, and no fixture renders one under it", () => {
    expect(Object.hasOwn(MARKDOWN_ELEMENTS, "style")).toBe(false);
    expect(
      Object.values(MARKDOWN_ELEMENTS)
        .flatMap(({ attributes }) => attributes ?? [])
        .filter((name) => name.includes("style")),
    ).toEqual([]);
    const styled = RENDERS.filter(({ preset }) => preset.includes(" style=") || preset.includes("<style"));
    expect(styled).toEqual([]);
    expect(SOURCES.filter((source) => source.includes("<style"))).not.toEqual([]);
  });

  test("freezes the record, every rule and every list a rule holds", () => {
    expect(Object.isFrozen(MARKDOWN_ELEMENTS)).toBe(true);
    for (const rule of Object.values(MARKDOWN_ELEMENTS)) {
      expect(Object.isFrozen(rule)).toBe(true);
      for (const list of [rule.attributes, rule.urls, rule.requires]) if (list !== undefined) expect(Object.isFrozen(list)).toBe(true);
    }
  });

  test("sends href and src through the schema's url policy, dropping a link whose href is refused", () => {
    const html = renderMarkdownHtml(parseMarkdown("[x](javascript:a) ![y](javascript:b)"), {
      schema: { elements: MARKDOWN_ELEMENTS, url: () => null },
    });
    expect(html).toBe('<p>x <img alt="y"></p>');
  });
});

describe("MARKDOWN_ELEMENTS rebuilding a consumer's schema", () => {
  const ALIGN = /^(left|center|right)$/;
  const TASK_LIST = /^contains-task-list$/;

  test("rebuilds starter's schema as the preset plus its patterns, rendering every fixture identically", () => {
    const { a, code, h2, img, input, li, ol, section, td, th, ul } = MARKDOWN_ELEMENTS;
    const rebuilt: HtmlSchema = {
      url: STARTER_SCHEMA.url,
      elements: {
        ...MARKDOWN_ELEMENTS,
        p: { attributes: ["class"], patterns: { class: /^callout-title$/ } },
        h2: { ...h2, patterns: { class: /^sr-only$/ } },
        ul: { ...ul, patterns: { class: TASK_LIST } },
        ol: { ...ol, patterns: { start: /^\d+$/, class: TASK_LIST } },
        li: { ...li, patterns: { class: /^task-list-item$/ } },
        input: { ...input, patterns: { type: /^checkbox$/ }, requires: ["type"] },
        th: { ...th, patterns: { align: ALIGN } },
        td: { ...td, patterns: { align: ALIGN } },
        code: { ...code, patterns: { class: /^language-[\w-]+$/ } },
        a: { ...a, patterns: { class: /^(wiki-link|data-footnote-backref)$/ } },
        img: { ...img, requires: ["src"] },
        section: { ...section, patterns: { class: /^footnotes$/ } },
        aside: { attributes: ["class"], patterns: { class: /^callout callout-(note|tip|warning)$/ } },
      },
    };
    const differing = DOCUMENTS.filter(
      (document) => renderMarkdownHtml(document, { schema: rebuilt }) !== renderMarkdownHtml(document, { schema: STARTER_SCHEMA }),
    );
    expect(differing.map(({ source }) => source)).toEqual([]);
  });

  test("rebuilds crucible's schema as the preset under its global attributes, rendering every fixture identically", () => {
    const globals = CRUCIBLE_SCHEMA.elements.mark;
    const withGlobals = (rule: ElementRule): ElementRule => ({
      ...rule,
      attributes: [...(globals?.attributes ?? []), ...(rule.attributes ?? [])],
      patterns: { ...globals?.patterns, ...rule.patterns },
    });
    const rules: Record<string, ElementRule> = {
      ...MARKDOWN_ELEMENTS,
      a: { ...MARKDOWN_ELEMENTS.a, patterns: { "aria-describedby": /^md-/ } },
      aside: {},
      mark: {},
      span: { attributes: ["title"] },
      time: { attributes: ["datetime"], patterns: { datetime: /^\d{4}-\d{2}-\d{2}$/ } },
    };
    const rebuilt: HtmlSchema = {
      url: CRUCIBLE_SCHEMA.url,
      elements: Object.fromEntries(Object.entries(rules).map(([tag, rule]) => [tag, withGlobals(rule)])),
    };
    const differing = DOCUMENTS.filter(
      (document) =>
        renderMarkdownHtml(document, { ...CRUCIBLE_RENDER_OPTIONS, schema: rebuilt }) !==
        renderMarkdownHtml(document, { ...CRUCIBLE_RENDER_OPTIONS, schema: CRUCIBLE_SCHEMA }),
    );
    expect(differing.map(({ source }) => source)).toEqual([]);
  });
});
