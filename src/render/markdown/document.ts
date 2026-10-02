import { scanBlocks } from "./block";
import { parseInline } from "./inline";
import { COMMONMARK } from "./syntax";
import type {
  InlineContext,
  MarkdownBlock,
  MarkdownDocument,
  MarkdownInline,
  MarkdownSyntax,
  MarkdownUnit,
  UnitCache,
  UnitCacheEntry,
} from "./types";

const LINK_LOOKUP = "l:";
const FOOTNOTE_LOOKUP = "f:";
const DEFAULT_CACHE_ENTRIES = 4096;
const BYTE_ORDER_MARK = 0xfeff;

/** Creates an in-memory unit cache holding at most `limit` entries, evicting the oldest. */
export function createUnitCache(limit = DEFAULT_CACHE_ENTRIES): UnitCache {
  const entries = new Map<string, UnitCacheEntry>();
  return {
    get: (text) => entries.get(text),
    set(text, entry) {
      entries.delete(text);
      entries.set(text, entry);
      if (entries.size > limit) entries.delete(entries.keys().next().value as string);
    },
  };
}

interface Placed {
  node: MarkdownBlock;
  parent: MarkdownBlock | null;
  index: number;
}

function childBlocks(node: MarkdownBlock): readonly MarkdownBlock[] {
  if (node.type === "paragraph" || node.type === "heading" || node.type === "tableCell") return [];
  return "children" in node ? (node.children as readonly MarkdownBlock[]) : [];
}

// mdast drops the one character after a task marker from the first text node, whatever it is; the engine renders as mdast did.
function dropTaskSeparator(children: MarkdownInline[]): void {
  const first = children[0];
  if (first?.type !== "text") return;
  first.value = first.value.slice(1);
  first.start += 1;
  if (first.value === "") children.shift();
}

function parseLeaves(document: MarkdownDocument, unit: MarkdownUnit, syntax: MarkdownSyntax, lookups: Map<string, boolean>): void {
  const { source } = document;
  const isDefined = (label: string) => {
    const found = document.definitions.has(label);
    lookups.set(LINK_LOOKUP + label, found);
    return found;
  };
  const isFootnoteDefined = (label: string) => {
    const found = document.footnoteDefinitions.has(label);
    lookups.set(FOOTNOTE_LOOKUP + label, found);
    return found;
  };
  const stack: Placed[] = [{ node: unit.node, parent: null, index: 0 }];
  for (let placed = stack.pop(); placed !== undefined; placed = stack.pop()) {
    const { node, parent, index } = placed;
    if (node.type === "paragraph" || node.type === "heading" || node.type === "tableCell") {
      const context: InlineContext = {
        isDefined,
        isFootnoteDefined,
        tableCell: node.type === "tableCell",
        syntax,
        leaf: node,
        leafIndex: index,
        container: parent,
      };
      node.children = parseInline(source, unit.start, node.segments, context);
      if (index === 0 && parent?.type === "listItem" && parent.checked !== null) dropTaskSeparator(node.children);
      continue;
    }
    const children = childBlocks(node);
    for (let child = children.length - 1; child >= 0; child--) stack.push({ node: children[child] as MarkdownBlock, parent: node, index: child });
  }
}

function applyTransforms(document: MarkdownDocument, unit: MarkdownUnit, syntax: MarkdownSyntax): void {
  if (syntax.blocks.size === 0) return;
  const context = { text: document.source.slice(unit.start, unit.end) };
  const stack: Placed[] = [{ node: unit.node, parent: null, index: 0 }];
  for (let placed = stack.pop(); placed !== undefined; placed = stack.pop()) {
    let { node } = placed;
    for (const transform of syntax.blocks.get(node.type) ?? []) {
      const replacement = transform.transform(node, context);
      if (replacement === null) continue;
      if (placed.parent === null) unit.node = replacement;
      else (placed.parent as { children: MarkdownBlock[] }).children[placed.index] = replacement;
      node = replacement;
      break;
    }
    const children = childBlocks(node);
    for (let child = children.length - 1; child >= 0; child--) stack.push({ node: children[child] as MarkdownBlock, parent: node, index: child });
  }
}

function stillResolves(
  entry: UnitCacheEntry,
  document: MarkdownDocument,
  syntax: MarkdownSyntax,
  unit: MarkdownUnit,
  byteOrderMark: boolean,
): boolean {
  if (entry.syntax !== syntax || entry.byteOrderMark !== byteOrderMark || entry.interrupting !== unit.interrupting) return false;
  for (const [key, found] of entry.lookups) {
    const label = key.slice(LINK_LOOKUP.length);
    const now = key.startsWith(LINK_LOOKUP) ? document.definitions.has(label) : document.footnoteDefinitions.has(label);
    if (now !== found) return false;
  }
  return true;
}

/** Parses a source under a syntax: the block phase, the inline phase over every leaf, then each unit's block transforms, reusing `cache` hits. */
export function parseMarkdown(source: string, syntax: MarkdownSyntax = COMMONMARK, cache?: UnitCache): MarkdownDocument {
  const document = scanBlocks(source);
  for (const unit of document.units) {
    const text = cache === undefined ? "" : source.slice(unit.start, unit.end);
    const cached = cache?.get(text);
    const byteOrderMark = unit.start === 0 && source.charCodeAt(0) === BYTE_ORDER_MARK;
    if (cached !== undefined && stillResolves(cached, document, syntax, unit, byteOrderMark)) {
      unit.node = cached.node;
      continue;
    }
    const lookups = new Map<string, boolean>();
    parseLeaves(document, unit, syntax, lookups);
    applyTransforms(document, unit, syntax);
    cache?.set(text, { syntax, node: unit.node, lookups, byteOrderMark, interrupting: unit.interrupting });
  }
  return document;
}
