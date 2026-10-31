import type { ElementRule } from "./types";

function freezeRules(rules: Record<string, ElementRule>): Readonly<Record<string, ElementRule>> {
  const freezeList = (list: readonly string[]) => Object.freeze([...list]);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(rules).map(([tag, rule]): [string, ElementRule] => {
        const frozen: ElementRule = { ...rule };
        if (rule.attributes !== undefined) frozen.attributes = freezeList(rule.attributes);
        if (rule.urls !== undefined) frozen.urls = freezeList(rule.urls);
        if (rule.requires !== undefined) frozen.requires = freezeList(rule.requires);
        return [tag, Object.freeze(frozen)];
      }),
    ),
  );
}

/** Every element and attribute the default handlers write, never `style`, for spreading into `HtmlSchema.elements` beside your own `url` policy. */
export const MARKDOWN_ELEMENTS: Readonly<Record<string, ElementRule>> = freezeRules({
  p: { attributes: ["data-line"] },
  h1: { attributes: ["data-line"] },
  h2: { attributes: ["data-line", "class", "id"] },
  h3: { attributes: ["data-line"] },
  h4: { attributes: ["data-line"] },
  h5: { attributes: ["data-line"] },
  h6: { attributes: ["data-line"] },
  hr: { attributes: ["data-line"] },
  blockquote: { attributes: ["data-line"] },
  pre: { attributes: ["data-line"] },
  code: { attributes: ["class"] },
  ul: { attributes: ["class", "data-line"] },
  ol: { attributes: ["start", "class", "data-line"] },
  li: { attributes: ["class", "id"] },
  label: {},
  input: { attributes: ["type", "name", "value", "checked", "disabled"] },
  em: {},
  strong: {},
  del: {},
  br: {},
  sup: {},
  a: {
    attributes: ["href", "title", "rel", "id", "data-footnote-ref", "aria-describedby", "data-footnote-backref", "aria-label", "class"],
    urls: ["href"],
    requires: ["href"],
  },
  img: { attributes: ["src", "alt", "title"], urls: ["src"] },
  table: { attributes: ["data-line"] },
  thead: {},
  tbody: {},
  tr: {},
  th: { attributes: ["align"] },
  td: { attributes: ["align"] },
  section: { attributes: ["data-footnotes", "class"] },
});
