/** Source lines a leaf holds, as flat triples of start offset, end offset before the line ending, and spaces a partly consumed tab leaves. */
export type MarkdownSegments = readonly number[];

/** Where a node sits, in UTF-16 offsets relative to the start of the unit that holds it. */
export interface MarkdownSpan {
  start: number;
  end: number;
}

/** A run of literal text, with escapes and character references already decoded. */
export interface MarkdownText extends MarkdownSpan {
  type: "text";
  value: string;
}

/** A `*` or `_` emphasis. */
export interface MarkdownEmphasis extends MarkdownSpan {
  type: "emphasis";
  children: MarkdownInline[];
}

/** A `**` or `__` strong emphasis. */
export interface MarkdownStrong extends MarkdownSpan {
  type: "strong";
  children: MarkdownInline[];
}

/** A GFM `~~` strikethrough. */
export interface MarkdownDelete extends MarkdownSpan {
  type: "delete";
  children: MarkdownInline[];
}

/** A backtick code span. */
export interface MarkdownInlineCode extends MarkdownSpan {
  type: "inlineCode";
  value: string;
}

/** A hard line break: a backslash, or two or more spaces, before a line ending inside a leaf. */
export interface MarkdownBreak extends MarkdownSpan {
  type: "break";
}

/** An inline link or autolink, its destination already unescaped. */
export interface MarkdownLink extends MarkdownSpan {
  type: "link";
  url: string;
  title: string | null;
  children: MarkdownInline[];
}

/** An inline image; its alt text is the plain text of its children. */
export interface MarkdownImage extends MarkdownSpan {
  type: "image";
  url: string;
  title: string | null;
  children: MarkdownInline[];
}

/** How a reference names its definition: `[a][b]`, `[a][]` or `[a]`. */
export type MarkdownReferenceType = "full" | "collapsed" | "shortcut";

/** A link through a definition, which keeps the normalised label and resolves its URL at render time. */
export interface MarkdownLinkReference extends MarkdownSpan {
  type: "linkReference";
  label: string;
  referenceType: MarkdownReferenceType;
  children: MarkdownInline[];
}

/** An image through a definition, resolved at render time like a link reference. */
export interface MarkdownImageReference extends MarkdownSpan {
  type: "imageReference";
  label: string;
  referenceType: MarkdownReferenceType;
  children: MarkdownInline[];
}

/** A GFM `[^label]` footnote call, numbered at render time. */
export interface MarkdownFootnoteReference extends MarkdownSpan {
  type: "footnoteReference";
  label: string;
}

/** A `[[target]]` or `[[target|label]]` wiki link, its target the raw text between the brackets. */
export interface MarkdownWikiLink extends MarkdownSpan {
  type: "wikiLink";
  target: string;
  label?: string | undefined;
}

/** A `![[target|alt]]` embed, its id what the wiki link construct's `embedId` answered for the target. */
export interface MarkdownEmbed extends MarkdownSpan {
  type: "embed";
  id: string;
  alt?: string | undefined;
}

/** A `#tag` or `#area/sub` tag. */
export interface MarkdownTag extends MarkdownSpan {
  type: "tag";
  name: string;
}

/** A `==text==` highlight. */
export interface MarkdownHighlight extends MarkdownSpan {
  type: "highlight";
  children: MarkdownInline[];
}

/** A `due:YYYY-MM-DD` or 📅 due date on a task item. */
export interface MarkdownTaskDue extends MarkdownSpan {
  type: "taskDue";
  date: string;
}

/** A `> [!kind] Title` callout, replacing the blockquote it was written as; `kind` is lowercased. */
export interface MarkdownCallout extends MarkdownSpan {
  type: "callout";
  kind: string;
  title: MarkdownInline[];
  children: MarkdownBlock[];
}

/** Any inline node a dialect construct adds. */
export type MarkdownExtensionInline = MarkdownWikiLink | MarkdownEmbed | MarkdownTag | MarkdownHighlight | MarkdownTaskDue;

/** Any block node a dialect transform adds. */
export type MarkdownExtensionBlock = MarkdownCallout;

/** Any inline node the engine produces. */
export type MarkdownInline =
  | MarkdownText
  | MarkdownEmphasis
  | MarkdownStrong
  | MarkdownDelete
  | MarkdownInlineCode
  | MarkdownBreak
  | MarkdownLink
  | MarkdownImage
  | MarkdownLinkReference
  | MarkdownImageReference
  | MarkdownFootnoteReference
  | MarkdownExtensionInline;

/** A paragraph; `children` stays empty until the inline phase runs over `segments`. */
export interface MarkdownParagraph extends MarkdownSpan {
  type: "paragraph";
  segments: MarkdownSegments;
  children: MarkdownInline[];
}

/** An ATX or setext heading. */
export interface MarkdownHeading extends MarkdownSpan {
  type: "heading";
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  segments: MarkdownSegments;
  children: MarkdownInline[];
}

/** A `***`, `---` or `___` rule on a line of its own. */
export interface MarkdownThematicBreak extends MarkdownSpan {
  type: "thematicBreak";
}

/** A `>` block quote, holding the blocks written inside it. */
export interface MarkdownBlockquote extends MarkdownSpan {
  type: "blockquote";
  children: MarkdownBlock[];
}

/** An indented or fenced code block; `lang` and `meta` are the info string's first word and the rest. */
export interface MarkdownCode extends MarkdownSpan {
  type: "code";
  fenced: boolean;
  lang: string | null;
  meta: string | null;
  segments: MarkdownSegments;
}

/** A list item; `checked` is a GFM task marker's state, or null for a plain item. */
export interface MarkdownListItem extends MarkdownSpan {
  type: "listItem";
  spread: boolean;
  checked: boolean | null;
  children: MarkdownBlock[];
}

/** A list nested inside another block; a top-level list is spread across units instead. */
export interface MarkdownList extends MarkdownSpan, MarkdownListInfo {
  type: "list";
  children: MarkdownListItem[];
}

/** A link reference definition, left in the tree where it was written. */
export interface MarkdownDefinition extends MarkdownSpan {
  type: "definition";
  label: string;
}

/** A GFM `[^label]:` footnote definition, holding the blocks written inside it. */
export interface MarkdownFootnoteDefinition extends MarkdownSpan {
  type: "footnoteDefinition";
  label: string;
  children: MarkdownBlock[];
}

/** A GFM table column's alignment, read from the colons in its delimiter row, or null for none. */
export type MarkdownAlign = "left" | "right" | "center" | null;

/** A GFM table; its first row is the header. */
export interface MarkdownTable extends MarkdownSpan {
  type: "table";
  align: MarkdownAlign[];
  children: MarkdownTableRow[];
}

/** A GFM table row; a table's first row is its header. */
export interface MarkdownTableRow extends MarkdownSpan {
  type: "tableRow";
  children: MarkdownTableCell[];
}

/** A GFM table cell; `children` stays empty until the inline phase runs over `segments`. */
export interface MarkdownTableCell extends MarkdownSpan {
  type: "tableCell";
  segments: MarkdownSegments;
  children: MarkdownInline[];
}

/** Any block node the engine produces. */
export type MarkdownBlock =
  | MarkdownParagraph
  | MarkdownHeading
  | MarkdownThematicBreak
  | MarkdownBlockquote
  | MarkdownCode
  | MarkdownList
  | MarkdownListItem
  | MarkdownDefinition
  | MarkdownFootnoteDefinition
  | MarkdownTable
  | MarkdownTableRow
  | MarkdownTableCell
  | MarkdownExtensionBlock;

/** Any node the engine produces. */
export type MarkdownNode = MarkdownBlock | MarkdownInline;

/** What every unit of one top-level list shares; `spread` is a loose list's flag, decided over the whole list. */
export interface MarkdownListInfo {
  ordered: boolean;
  firstNumber: number | null;
  spread: boolean;
}

/** Where a unit sits in its source; `neutral` marks one whose first line the scanner began with no block open, so a rescan may resume there. */
export interface MarkdownUnitBounds {
  start: number;
  end: number;
  neutral: boolean;
}

/** A top-level block, or one item of a top-level list, with its node's offsets relative to `start`; `interrupting` marks one opened on a line that interrupted a paragraph. */
export interface MarkdownUnit extends MarkdownUnitBounds {
  line: number;
  node: MarkdownBlock;
  list?: MarkdownListInfo | undefined;
  interrupting: boolean;
}

/** A link reference definition's target, its destination and title already unescaped. */
export interface MarkdownDefinitionTarget {
  url: string;
  title: string | null;
}

/** A parsed source: its units in order, and what references resolve against. */
export interface MarkdownDocument {
  source: string;
  units: MarkdownUnit[];
  definitions: ReadonlyMap<string, MarkdownDefinitionTarget>;
  footnoteDefinitions: ReadonlySet<string>;
  lineStarts: Int32Array;
}

/** Where an extension's inline node landed, for its construct to keep it or turn it back into its source text. */
export interface InlineAcceptContext {
  inLink: boolean;
  inImage: boolean;
  leaf: MarkdownParagraph | MarkdownHeading | MarkdownTableCell;
  leafIndex: number;
  container: MarkdownBlock | null;
}

/** What a construct's scan found: the offset in the leaf's content where it ends, and its node, whose span the engine fills in. */
export interface InlineMatch {
  end: number;
  node: MarkdownExtensionInline;
}

/** An inline construct started by a trigger; its scan sees only two code units before the trigger and `maxLength`, at most 1024, from it. */
export interface InlineConstruct {
  name: string;
  triggers: readonly number[];
  maxLength: number;
  scan: (content: string, at: number, limit: number) => InlineMatch | null;
  accept?: ((node: MarkdownExtensionInline, context: InlineAcceptContext) => boolean) | undefined;
}

/** A span opened and closed by an exact run of two `char`s on the shared delimiter stack, wrapping what lies between in a `type` node. */
export interface DelimiterConstruct {
  char: number;
  type: MarkdownExtensionInline["type"];
}

/** What a block transform may read beyond the node itself: its unit's text, which the node's offsets index directly. */
export interface BlockTransformContext {
  text: string;
}

/** A rewrite of one finished block type, applied after its unit's inline phase; returning null keeps the block. */
export interface BlockTransform {
  type: MarkdownBlock["type"];
  transform: (node: MarkdownBlock, context: BlockTransformContext) => MarkdownExtensionBlock | null;
}

/** The extensions a syntax adds to CommonMark and GFM. */
export interface MarkdownSyntaxDefinition {
  inline?: readonly InlineConstruct[] | undefined;
  delimiters?: readonly DelimiterConstruct[] | undefined;
  blocks?: readonly BlockTransform[] | undefined;
}

/** A validated syntax, indexed the way the engine looks its extensions up. */
export interface MarkdownSyntax {
  triggers: ReadonlyMap<number, readonly InlineConstruct[]>;
  delimiters: ReadonlyMap<number, MarkdownExtensionInline["type"]>;
  blocks: ReadonlyMap<string, readonly BlockTransform[]>;
}

/** What one element may carry: its allowed attributes, the values some must match, which are URLs, and which must survive for it to be kept. */
export interface ElementRule {
  tag?: string | undefined;
  attributes?: readonly string[] | undefined;
  patterns?: Readonly<Record<string, RegExp>> | undefined;
  urls?: readonly string[] | undefined;
  requires?: readonly string[] | undefined;
}

/** A URL a writer is about to emit: its value, the attribute carrying it, and the element that attribute is on. */
export interface HtmlUrlCandidate {
  readonly value: string;
  readonly attribute: string;
  readonly tag: string;
}

/** The allowlist a writer emits by: every element it may write, and the policy every URL attribute passes through. */
export interface HtmlSchema {
  elements: Readonly<Record<string, ElementRule>>;
  url: (candidate: HtmlUrlCandidate) => string | null;
}

/** An element's attributes in the order they are written; `true` writes a bare boolean attribute and `false` omits it. */
export type HtmlAttributes = readonly (readonly [name: string, value: string | boolean])[];

/** The only way markup is written: elements outside the schema are dropped with their text kept, and no raw HTML can be emitted. */
export interface HtmlWriter {
  open: (tag: string, attributes?: HtmlAttributes) => void;
  close: () => void;
  text: (value: string) => void;
  mark: () => number;
  rewind: (mark: number) => void;
  html: () => string;
}

/** What a handler sees while one node is rendered. */
export interface MarkdownRenderContext {
  writer: HtmlWriter;
  document: MarkdownDocument;
  unit: MarkdownUnit;
  tight: boolean;
  topLevel: boolean;
  line: number;
  task: boolean | null;
  render: (node: MarkdownNode) => void;
}

/** How children are laid out: `block` puts a line ending between them, `loose` also after the open and before the close, `inline` none. */
export type MarkdownChildLayout = "inline" | "block" | "loose";

/** Renders one node type: what it writes on entering and leaving, and how its children are laid out, if it has any to render. */
export interface MarkdownNodeHandler {
  enter: (node: MarkdownNode, context: MarkdownRenderContext) => void;
  leave?: ((node: MarkdownNode, context: MarkdownRenderContext) => void) | undefined;
  children?: ((node: MarkdownNode, context: MarkdownRenderContext) => readonly MarkdownNode[] | null) | undefined;
  layout?: MarkdownChildLayout | undefined;
}

/** The handlers `renderMarkdownHtml` falls back to for a node type a caller does not override. */
export type MarkdownNodeHandlers = Readonly<Record<string, MarkdownNodeHandler>>;

/** The ids footnotes render with, each defaulting to mdast-util-to-hast's; `emptyFlagValues` writes their flag attributes as `=""`. */
export interface MarkdownFootnoteOptions {
  idPrefix?: string | undefined;
  labelId?: string | undefined;
  emptyFlagValues?: boolean | undefined;
}

/** What `renderMarkdownHtml` renders with. */
export interface MarkdownRenderOptions {
  schema: HtmlSchema;
  handlers?: MarkdownNodeHandlers | undefined;
  lineAnchors?: boolean | undefined;
  footnotes?: MarkdownFootnoteOptions | undefined;
  classNames?: Readonly<Record<string, string | null>> | undefined;
}

/** A unit's parsed node, reusable for any unit with the same text while every label it looked up still resolves as it did. */
export interface UnitCacheEntry {
  syntax: MarkdownSyntax;
  node: MarkdownBlock;
  lookups: ReadonlyMap<string, boolean>;
  byteOrderMark: boolean;
  interrupting: boolean;
}

/** Where `parseMarkdown` keeps units it has parsed, keyed by a unit's text; a caller may key by a hash of it instead. */
export interface UnitCache {
  get: (text: string) => UnitCacheEntry | undefined;
  set: (text: string, entry: UnitCacheEntry) => void;
}

/** The shape `walkTree` reads: a typed node that may hold children of its own kind. @internal */
export interface WalkNode {
  readonly type: string;
  readonly children?: readonly WalkNode[] | undefined;
}

/** Called on entering a node with the path above it, nearest last; returning false skips the node's children. @internal */
export type EnterVisitor<N extends WalkNode> = (node: N, ancestors: readonly N[]) => boolean | undefined;

/** Called on leaving a node, after its children, with the path above it, nearest last. @internal */
export type LeaveVisitor<N extends WalkNode> = (node: N, ancestors: readonly N[]) => void;

/** What the inline phase asks of the document around the leaf it parses. @internal */
export interface InlineContext {
  isDefined: (label: string) => boolean;
  isFootnoteDefined: (label: string) => boolean;
  tableCell: boolean;
  syntax: MarkdownSyntax;
  leaf: MarkdownParagraph | MarkdownHeading | MarkdownTableCell;
  leafIndex: number;
  container: MarkdownBlock | null;
}

/** The inline node kinds an item can become, plus the root every item of a leaf hangs from. @internal */
export type ItemKind =
  | "root"
  | "text"
  | "emphasis"
  | "strong"
  | "delete"
  | "inlineCode"
  | "break"
  | "link"
  | "image"
  | "linkReference"
  | "imageReference"
  | "footnoteReference"
  | "extension";

/** One inline node while a leaf is being parsed, linked to its siblings so wrapping a run of them costs nothing per sibling. @internal */
export interface Item {
  kind: ItemKind;
  start: number;
  end: number;
  value: string;
  plain: boolean;
  literal: boolean;
  url: string;
  title: string | null;
  label: string;
  referenceType: MarkdownReferenceType;
  extension: MarkdownExtensionInline | null;
  extensionType: string;
  construct: InlineConstruct | null;
  parent: Item | null;
  prev: Item | null;
  next: Item | null;
  first: Item | null;
  last: Item | null;
}

/** A run of delimiter characters that may open or close emphasis, strikethrough or an extension span. @internal */
export interface Delimiter {
  item: Item;
  position: number;
  char: number;
  count: number;
  original: number;
  canOpen: boolean;
  canClose: boolean;
  exact: boolean;
  prev: Delimiter | null;
  next: Delimiter | null;
}

/** The delimiter stack of one leaf: its top, and the node type each exact-length delimiter character wraps in. @internal */
export interface DelimiterStack {
  top: Delimiter | null;
  exactTypes: ReadonlyMap<number, string>;
}

/** A literal autolink found in inline content: where it ends and the URL it links to. @internal */
export interface LiteralAutolink {
  end: number;
  url: string;
}

/** A character reference read at an offset: the text it stands for and the offset just past its semicolon. @internal */
export interface CharacterReference {
  text: string;
  end: number;
}

/** A link destination's raw extent; `textStart` and `textEnd` exclude the angle brackets of a `<…>` form. @internal */
export interface DestinationScan {
  end: number;
  textStart: number;
  textEnd: number;
}

/** A link reference definition read from paragraph content. @internal */
export interface DefinitionScan {
  end: number;
  label: string;
  url: string;
  title: string | null;
}

/** Where `walkMarkdown` found a node: the source offset its span is relative to, and the nodes above it, nearest last. */
export interface MarkdownWalkContext {
  base: number;
  ancestors: readonly MarkdownNode[];
}

/** How a wiki link construct reads an embed: `embedId` answers the id a `![[target]]` names, or null to leave it as text. */
export interface WikiLinkConstructOptions {
  readonly embedId: (target: string) => string | null;
}

/** An element of a tokenized svg fence: its name as written, its attributes in order, and its children. @internal */
export interface SvgElement {
  name: string;
  attributes: [string, string][];
  children: SvgNode[];
}

/** A child of an svg element: an element, or text with its references decoded. @internal */
export type SvgNode = SvgElement | string;

/** An svg element once sanitised: its SVG-case tag, its kept attributes in order, and its children. */
export interface SanitizedSvg {
  tag: string;
  attributes: HtmlAttributes;
  children: (SanitizedSvg | string)[];
}
