import { codeBlockText, inlinePlainText } from "./mod";
import type { MarkdownBlock, MarkdownDocument, MarkdownInline, MarkdownListInfo } from "./mod";

/** A node as the dialect specs assert it: mdast's field names, without positions. */
export interface Shaped {
  readonly type: string;
  readonly children?: readonly Shaped[] | undefined;
  readonly [field: string]: unknown;
}

export function withoutPositions<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutPositions) as T;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, field]) => (key === "position" ? [] : [[key, withoutPositions(field)]]))) as T;
}

function shapeInline(node: MarkdownInline): Shaped {
  const children = (nodes: readonly MarkdownInline[]) => nodes.map(shapeInline);
  switch (node.type) {
    case "image":
      return { type: "image", url: node.url, title: node.title, alt: inlinePlainText(node.children) };
    case "imageReference":
      return {
        type: "imageReference",
        identifier: node.label.toLowerCase(),
        referenceType: node.referenceType,
        alt: inlinePlainText(node.children),
      };
    case "linkReference":
      return { type: "linkReference", identifier: node.label.toLowerCase(), referenceType: node.referenceType, children: children(node.children) };
    case "footnoteReference":
      return { type: "footnoteReference", identifier: node.label.toLowerCase() };
    case "link":
    case "emphasis":
    case "strong":
    case "delete":
    case "highlight": {
      const { start: _start, end: _end, ...rest } = node;
      return { ...rest, children: children(node.children) };
    }
    default: {
      const { start: _start, end: _end, ...rest } = node;
      return rest;
    }
  }
}

function shapeBlock(node: MarkdownBlock, document: MarkdownDocument, base: number): Shaped {
  const blocks = (nodes: readonly MarkdownBlock[]) => nodes.map((child) => shapeBlock(child, document, base));
  const inlines = (nodes: readonly MarkdownInline[]) => nodes.map(shapeInline);
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", children: inlines(node.children) };
    case "heading":
      return { type: "heading", depth: node.depth, children: inlines(node.children) };
    case "thematicBreak":
      return { type: "thematicBreak" };
    case "blockquote":
      return { type: "blockquote", children: blocks(node.children) };
    case "code":
      return { type: "code", lang: node.lang, meta: node.meta, value: codeBlockText(document.source, base, node.segments) };
    case "list":
      return { type: "list", ordered: node.ordered, start: node.firstNumber, spread: node.spread, children: blocks(node.children) };
    case "listItem":
      return { type: "listItem", spread: node.spread, checked: node.checked, children: blocks(node.children) };
    case "definition": {
      const target = document.definitions.get(node.label);
      return { type: "definition", identifier: node.label.toLowerCase(), url: target?.url, title: target?.title };
    }
    case "footnoteDefinition":
      return { type: "footnoteDefinition", identifier: node.label.toLowerCase(), children: blocks(node.children) };
    case "table":
      return { type: "table", align: node.align, children: blocks(node.children) };
    case "tableRow":
      return { type: "tableRow", children: blocks(node.children) };
    case "tableCell":
      return { type: "tableCell", children: inlines(node.children) };
    case "callout":
      return { type: "callout", kind: node.kind, title: inlines(node.title), children: blocks(node.children) };
  }
}

/** Projects a parsed document to the shape the dialect specs assert: top-level list items regrouped into lists, positions dropped. */
export function shapeOf(document: MarkdownDocument): { readonly type: "root"; readonly children: readonly Shaped[] } {
  const children: Shaped[] = [];
  let list: { info: MarkdownListInfo; items: Shaped[] } | undefined;
  for (const unit of document.units) {
    const node = shapeBlock(unit.node, document, unit.start);
    if (unit.list === undefined) {
      list = undefined;
      children.push(node);
    } else if (list?.info === unit.list) list.items.push(node);
    else {
      list = { info: unit.list, items: [node] };
      children.push({ type: "list", ordered: unit.list.ordered, start: unit.list.firstNumber, spread: unit.list.spread, children: list.items });
    }
  }
  return { type: "root", children };
}
