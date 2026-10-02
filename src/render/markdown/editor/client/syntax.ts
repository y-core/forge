import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";

import type { EditorSyntaxNode } from "./types";

const LIST_NODES = new Set(["BulletList", "OrderedList"]);

type MarkdownExtension = NonNullable<NonNullable<Parameters<typeof markdown>[0]>["extensions"]>;
type MarkdownConfig = Exclude<MarkdownExtension, readonly unknown[]>;
type InlineParse = NonNullable<MarkdownConfig["parseInline"]>[number]["parse"];

const TILDE = 126;
const STRIKETHROUGH_DELIMITER = { resolve: "Strikethrough", mark: "StrikethroughMark" };
const WHITESPACE_OR_EDGE = /\s|^$/;
const PUNCTUATION = /[\p{S}\p{P}]/u;

function tildeRunLength(cx: Parameters<InlineParse>[0], pos: number): number {
  let end = pos;
  while (cx.char(end) === TILDE) end++;
  return end - pos;
}

const parseStrikethrough: InlineParse = (cx, next, pos) => {
  if (next !== TILDE) return -1;
  const run = tildeRunLength(cx, pos);
  if (run === 1) return -1;
  if (run > 2) return pos + run;
  const before = cx.slice(pos - 1, pos);
  const after = cx.slice(pos + 2, pos + 3);
  const spaceBefore = WHITESPACE_OR_EDGE.test(before);
  const spaceAfter = WHITESPACE_OR_EDGE.test(after);
  const punctBefore = PUNCTUATION.test(before);
  const punctAfter = PUNCTUATION.test(after);
  return cx.addDelimiter(
    STRIKETHROUGH_DELIMITER,
    pos,
    pos + 2,
    !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
    !spaceBefore && (!punctBefore || spaceAfter || punctAfter),
  );
};

// Lezer's GFM parser opens on the last two tildes of a longer run; micromark reads any run past two as text.
const STRIKETHROUGH: MarkdownConfig = { parseInline: [{ name: "Strikethrough", parse: parseStrikethrough }] };

/** Creates the markdown language with a `\n`-only line separator, so a typed `\r` stays content. @internal */
export function markdownSyntax(): Extension {
  return [
    markdown({
      base: markdownLanguage,
      extensions: [{ remove: ["Subscript", "Superscript", "Emoji"] }, STRIKETHROUGH],
      addKeymap: false,
      completeHTMLTags: false,
      pasteURLAsLink: false,
    }).language,
    EditorState.lineSeparator.of("\n"),
  ];
}

/** Lists the top-level units of the document, each top-level list item on its own. @internal */
export function topLevelUnits(state: EditorState): EditorSyntaxNode[] {
  const units: EditorSyntaxNode[] = [];
  for (let child = syntaxTree(state).topNode.firstChild; child; child = child.nextSibling) {
    if (!LIST_NODES.has(child.name)) {
      units.push(child);
      continue;
    }
    for (let item = child.firstChild; item; item = item.nextSibling) {
      if (item.name === "ListItem") units.push(item);
    }
  }
  return units;
}
