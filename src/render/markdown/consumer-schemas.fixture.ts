import type { ElementRule, HtmlSchema, MarkdownRenderOptions } from "./types";
import { isSafeUrl } from "./url-policy";

/** starter's `SCHEMA` from `src/showcase/model/markdown.ts`, without its SVG rules. */
export const STARTER_SCHEMA: HtmlSchema = {
  url: (candidate) => (isSafeUrl(candidate) ? candidate.value : null),
  elements: {
    p: { attributes: ["class"], patterns: { class: /^callout-title$/ } },
    h1: {},
    h2: { attributes: ["id", "class"], patterns: { class: /^sr-only$/ } },
    h3: {},
    h4: {},
    h5: {},
    h6: {},
    blockquote: {},
    pre: {},
    em: {},
    strong: {},
    del: {},
    hr: {},
    br: {},
    sup: {},
    table: {},
    thead: {},
    tbody: {},
    tr: {},
    ul: { attributes: ["class"], patterns: { class: /^contains-task-list$/ } },
    ol: { attributes: ["start", "class"], patterns: { start: /^\d+$/, class: /^contains-task-list$/ } },
    li: { attributes: ["id", "class"], patterns: { class: /^task-list-item$/ } },
    input: { attributes: ["type", "checked", "disabled"], patterns: { type: /^checkbox$/ }, requires: ["type"] },
    th: { attributes: ["align"], patterns: { align: /^(left|center|right)$/ } },
    td: { attributes: ["align"], patterns: { align: /^(left|center|right)$/ } },
    code: { attributes: ["class"], patterns: { class: /^language-[\w-]+$/ } },
    a: {
      attributes: ["href", "title", "class", "id", "aria-describedby", "aria-label", "data-footnote-ref", "data-footnote-backref"],
      patterns: { class: /^(wiki-link|data-footnote-backref)$/ },
      urls: ["href"],
      requires: ["href"],
    },
    img: { attributes: ["src", "alt", "title"], urls: ["src"], requires: ["src"] },
    section: { attributes: ["data-footnotes", "class"], patterns: { class: /^footnotes$/ } },
    aside: { attributes: ["class"], patterns: { class: /^callout callout-(note|tip|warning)$/ } },
  },
};

const CRUCIBLE_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "input",
  "pre",
  "code",
  "em",
  "strong",
  "del",
  "a",
  "img",
  "br",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "sup",
  "section",
  "aside",
  "mark",
  "span",
  "time",
] as const;

const GLOBAL_ATTRIBUTES = ["class", "id", "data-line"];
const GLOBAL_PATTERNS: Readonly<Record<string, RegExp>> = {
  class: /^md-[a-z0-9-]+(?: md-[a-z0-9-]+)*$/,
  id: /^(?:md|gv)-/,
  "data-line": /^[1-9][0-9]*$/,
};

function createCrucibleRule(attributes: readonly string[], extra: Partial<ElementRule> = {}): ElementRule {
  return {
    attributes: [...GLOBAL_ATTRIBUTES, ...attributes],
    patterns: { ...GLOBAL_PATTERNS, ...extra.patterns },
    ...(extra.urls && { urls: extra.urls }),
    ...(extra.requires && { requires: extra.requires }),
    ...(extra.tag && { tag: extra.tag }),
  };
}

/** crucible's `NOTES_SCHEMA` from `src/domains/notes/model/markdown/schema.ts`, without its SVG rules. */
export const CRUCIBLE_SCHEMA: HtmlSchema = {
  elements: {
    ...Object.fromEntries(CRUCIBLE_TAGS.map((tag) => [tag, createCrucibleRule([])])),
    a: createCrucibleRule(["href", "title", "aria-label", "aria-describedby", "data-footnote-ref", "data-footnote-backref"], {
      patterns: { "aria-describedby": /^md-/ },
      urls: ["href"],
      requires: ["href"],
    }),
    img: createCrucibleRule(["src", "alt", "title"], { urls: ["src"] }),
    input: createCrucibleRule(["type", "checked", "disabled"], { patterns: { type: /^checkbox$/ } }),
    ol: createCrucibleRule(["start"]),
    th: createCrucibleRule(["align"]),
    td: createCrucibleRule(["align"]),
    section: createCrucibleRule(["data-footnotes"]),
    span: createCrucibleRule(["title"]),
    time: createCrucibleRule(["datetime"], { patterns: { datetime: /^\d{4}-\d{2}-\d{2}$/ } }),
  },
  url: (candidate) => (isSafeUrl(candidate) ? candidate.value : null),
};

/** The options crucible's `toHtml` in `src/domains/notes/model/markdown/render.ts` renders with, less its schema and handlers. */
export const CRUCIBLE_RENDER_OPTIONS: Omit<MarkdownRenderOptions, "schema" | "handlers"> = {
  lineAnchors: true,
  footnotes: { idPrefix: "md-", labelId: "md-footnote-label", emptyFlagValues: true },
  classNames: {
    "contains-task-list": "md-task-list",
    "task-list-item": "md-task",
    footnotes: "md-footnotes",
    "sr-only": "md-footnotes-label",
    "data-footnote-backref": null,
  },
};
