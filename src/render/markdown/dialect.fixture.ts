import { createCalloutTransform } from "./callout";
import { parseMarkdown } from "./document";
import { defineMarkdownSyntax, HIGHLIGHT_DELIMITER } from "./syntax";
import { TAG_CONSTRUCT } from "./tag";
import { TASK_DUE_CONSTRUCT } from "./task-due";
import type { MarkdownDocument, MarkdownNodeHandler, MarkdownNodeHandlers, MarkdownSyntax } from "./types";
import { createWikiLinkConstruct } from "./wikilink";

const EMBED_TARGET = /^att:(.+)$/i;

/** The callout kinds the dialect specs parse with. */
export const CALLOUT_KINDS: readonly string[] = ["note", "tip", "warning", "danger", "conflict"];

/** Every dialect construct forge ships, composed the way an app composes them, with `att:` targets embedding. */
export const DIALECT_SYNTAX: MarkdownSyntax = defineMarkdownSyntax({
  inline: [
    createWikiLinkConstruct({ embedId: (target) => EMBED_TARGET.exec(target)?.[1]?.toLowerCase() ?? null }),
    TAG_CONSTRUCT,
    TASK_DUE_CONSTRUCT,
  ],
  delimiters: [HIGHLIGHT_DELIMITER],
  blocks: [createCalloutTransform(CALLOUT_KINDS)],
});

/** Parses markdown under the full dialect. */
export function parseDialect(md: string): MarkdownDocument {
  return parseMarkdown(md, DIALECT_SYNTAX);
}

function element(tag: string): MarkdownNodeHandler {
  return { enter: (_node, { writer }) => writer.open(tag), leave: (_node, { writer }) => writer.close(), layout: "inline" };
}

/** Handlers rendering every dialect node as a bare element, so a dialect document renders at all. */
export const DIALECT_HANDLERS: MarkdownNodeHandlers = {
  wikiLink: { enter: (node, { writer }) => (node.type === "wikiLink" ? writer.text(node.label ?? node.target) : undefined) },
  embed: { enter: (node, { writer }) => (node.type === "embed" ? writer.text(node.alt ?? "") : undefined) },
  tag: { enter: (node, { writer }) => (node.type === "tag" ? writer.text(`#${node.name}`) : undefined) },
  taskDue: { enter: (node, { writer }) => (node.type === "taskDue" ? writer.text(node.date) : undefined) },
  highlight: element("mark"),
  callout: { ...element("aside"), children: (node) => (node.type === "callout" ? node.children : null), layout: "loose" },
};
