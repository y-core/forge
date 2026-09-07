/** The markdown check's pure half: text → document, document → findings, document → text. No disk,
 *  no root, no path — every policy decision lives in `validateMarkdown`, and every rewrite in
 *  `renderMarkdown`, so the two halves of the dev loop are assertable from a string.
 */

import { type Finding, fail, warn } from "../finding";

/** How a line was classified; a `fence`, `frontmatter` or `indented-code` line is never rewritten. @public */
export type MarkdownLineKind =
  | "blank"
  | "frontmatter"
  | "fence"
  | "fence-marker"
  | "heading"
  | "setext-underline"
  | "thematic-break"
  | "blockquote"
  | "html"
  | "indented-code"
  | "table"
  | "list-item"
  | "paragraph";

/** A fenced code block, from its opening marker to its closing one, both 1-indexed and inclusive. @public */
export interface FenceSpan {
  start: number;
  end: number;
  /** The run of backticks or tildes the fence opened with. */
  marker: string;
  /** Leading whitespace of the opening marker. */
  indent: string;
  /** The info string as written — the language tag, or `""` for a bare fence. */
  info: string;
}

/** One row of a table, split into its raw cell texts. @public */
export interface TableRow {
  line: number;
  kind: "header" | "delimiter" | "body";
  cells: readonly string[];
}

/** A GFM table: a header row, its delimiter row, and the body rows under them. @public */
export interface TableBlock {
  start: number;
  end: number;
  indent: string;
  rows: readonly TableRow[];
}

/** One list item, with the items nested under it. @public */
export interface ListItem {
  line: number;
  /** Last line belonging to this item, including its continuations and children. */
  end: number;
  /** Columns of leading whitespace before the marker. */
  indent: number;
  /** The marker as written — `-`, `*`, `+`, or `1.` / `1)`. */
  marker: string;
  ordered: boolean;
  /** Column the item's content starts at, which is the indent its children are expected to hold. */
  contentColumn: number;
  children: readonly ListItem[];
}

/** An ATX or setext heading. @public */
export interface Heading {
  line: number;
  level: number;
  text: string;
  setext: boolean;
}

/** A block the blank-line rule applies to, at the top level of the document. @public */
export interface BlockSpan {
  kind: "heading" | "fence" | "table" | "list" | "blockquote";
  start: number;
  end: number;
}

/** One markdown document, classified line by line. @public */
export interface MarkdownDoc {
  lines: readonly string[];
  /** Parallel to `lines`, 0-indexed. */
  kinds: readonly MarkdownLineKind[];
  /** 1-indexed inclusive span of the YAML frontmatter, when the document opens with one. */
  frontmatter?: { start: number; end: number };
  fences: readonly FenceSpan[];
  tables: readonly TableBlock[];
  /** The top-level list items; nested ones hang off `children`. */
  lists: readonly ListItem[];
  headings: readonly Heading[];
  blocks: readonly BlockSpan[];
}

/** Which delimiters emphasis is written with. @public */
export interface EmphasisRule {
  strong: "**" | "__";
  em: "_" | "*";
}

/** How code fences are written, and what their info strings must say. @public */
export interface FenceRule {
  style: "backtick" | "tilde";
  /** Reports a fence with no language. Report-only: a fixer cannot guess one. */
  requireLanguage: boolean;
  /** Info strings rewritten to the corpus's majority spelling, e.g. `typescript` → `ts`. */
  aliases: Readonly<Record<string, string>>;
}

/** How much trailing whitespace survives. @public */
export interface TrailingWhitespaceRule {
  /** Width of a hard line break to preserve; every other trailing run is trimmed. */
  allowHardBreak: number;
}

/** Where over-long lines are reported, and how loudly. @public */
export interface LineLengthRule {
  limit: number;
  level: "fail" | "warn";
  /** Path prefixes the rule applies to; absent, it applies everywhere. */
  scope?: readonly string[];
}

/** The house markdown conventions. Every key is optional, and every one accepts `"off"`. @public */
export interface MarkdownRules {
  /** Collapse table cell padding to one space per side. */
  tables?: "compact" | "off";
  bulletMarker?: "-" | "*" | "+" | "off";
  orderedMarker?: "." | ")" | "off";
  /** Indent a nested list item to its parent's content column. */
  listIndent?: "content-column" | "off";
  emphasis?: EmphasisRule | "off";
  fence?: FenceRule | "off";
  hardTabs?: "forbid" | "off";
  trailingWhitespace?: TrailingWhitespaceRule | "off";
  thematicBreak?: "---" | "***" | "___" | "off";
  /** Reports reference-style links. Report-only. */
  linkStyle?: "inline" | "off";
  /** Reports a URL written without `<>` or a link. Report-only. */
  bareUrls?: "warn" | "fail" | "off";
  /** Reports a second level-1 heading. Report-only. */
  singleH1?: boolean;
  /** Block kinds that must be surrounded by a blank line. */
  blankLineAround?: readonly BlockSpan["kind"][] | "off";
  lineLength?: LineLengthRule | false;
}

/** Every rule resolved, with the library defaults applied. @public */
export type ResolvedMarkdownRules = Required<Omit<MarkdownRules, "lineLength">> & { lineLength: LineLengthRule | false };

/** What a rule means when a config leaves it out. @public */
export const DEFAULT_MARKDOWN_RULES: ResolvedMarkdownRules = {
  tables: "compact",
  bulletMarker: "-",
  orderedMarker: ".",
  listIndent: "content-column",
  emphasis: { strong: "**", em: "_" },
  fence: { style: "backtick", requireLanguage: true, aliases: {} },
  hardTabs: "forbid",
  trailingWhitespace: { allowHardBreak: 2 },
  thematicBreak: "---",
  linkStyle: "inline",
  bareUrls: "warn",
  singleH1: true,
  blankLineAround: ["heading", "fence", "table", "list", "blockquote"],
  lineLength: false,
};

/** Applies the defaults to a partial rule table. @public */
export function resolveMarkdownRules(rules: MarkdownRules = {}): ResolvedMarkdownRules {
  return { ...DEFAULT_MARKDOWN_RULES, ...rules };
}

const FENCE = /^(\s*)(`{3,}|~{3,})[ \t]*(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const SETEXT = /^ {0,3}=+[ \t]*$/;
const THEMATIC = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)/;
const BLOCKQUOTE = /^ {0,3}>/;
const HTML_BLOCK = /^ {0,3}<[A-Za-z!/?]/;
const DELIMITER_ROW = /^ {0,3}\|?(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*\|?[ \t]*$/;
const INDENTED = /^ {4,}\S/;

const STRONG = /(?<![\w*_])(\*\*|__)(?=[^\s*_])([\s\S]*?[^\s*_])\1(?![\w*_])/g;
const EMPHASIS = /(?<![\w*_\\])([*_])(?=[^\s*_])((?:[^*_]*?[^\s*_])|[^\s*_])\1(?![\w*_])/g;
const PLACEHOLDER = /\uE000(\d+)\uE000/g;

const REFERENCE_LINK = /\][ \t]*\[[^\]]+\]/;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:[ \t]+\S/;
const BARE_URL = /https?:\/\/\S/;

/** Splits a table row on its unescaped, uncoded cell separators. @public */
export function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const cells: string[] = [];
  let current = "";
  let ticks = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === "\\") {
      current += char + (trimmed[i + 1] ?? "");
      i++;
      continue;
    }
    // An unclosed run is literal text, not a span that swallows the rest of the row — otherwise a
    // cell holding a lone backtick would hide every separator after it.
    if (char === "`") ticks = ticks === 0 ? (trimmed.indexOf("`", i + 1) === -1 ? 0 : 1) : 0;
    if (char === "|" && ticks === 0) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  // A leading and a trailing pipe each open an empty cell that is punctuation, not data.
  if (cells.length > 1 && cells[0]?.trim() === "") cells.shift();
  if (cells.length > 1 && cells.at(-1)?.trim() === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

function alignmentOf(cell: string): string {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return ":---:";
  if (left) return ":---";
  if (right) return "---:";
  return "---";
}

/** Renders one table row in the compact form: one pipe, one space, the cell, one space. @public */
export function renderTableRow(row: TableRow, indent: string): string {
  const cells = row.kind === "delimiter" ? row.cells.map(alignmentOf) : row.cells;
  return `${indent}| ${cells.join(" | ")} |`;
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

type MutableItem = Omit<ListItem, "children"> & { children: MutableItem[] };

function buildTree(flat: readonly MutableItem[]): MutableItem[] {
  const roots: MutableItem[] = [];
  const stack: MutableItem[] = [];
  for (const item of flat) {
    while (stack.length > 0 && item.indent < (stack.at(-1)?.contentColumn ?? 0)) stack.pop();
    const parent = stack.at(-1);
    if (parent === undefined) roots.push(item);
    else parent.children.push(item);
    stack.push(item);
  }
  return roots;
}

/** Every item of a list tree, parents before children. @public */
export function flattenListItems(items: readonly ListItem[]): ListItem[] {
  return items.flatMap((item) => [item, ...flattenListItems(item.children)]);
}

/** Classifies every line of `source` into the blocks the rules are stated over. @public */
export function parseMarkdown(source: string): MarkdownDoc {
  const lines = source.split("\n");
  const kinds: MarkdownLineKind[] = lines.map(() => "paragraph");
  const fences: FenceSpan[] = [];
  const tables: TableBlock[] = [];
  const headings: Heading[] = [];
  const flatItems: MutableItem[] = [];
  const blocks: BlockSpan[] = [];

  let frontmatter: { start: number; end: number } | undefined;
  let start = 0;
  if (lines[0] === "---") {
    const close = lines.findIndex((line, index) => index > 0 && line === "---");
    if (close > 0) {
      frontmatter = { start: 1, end: close + 1 };
      for (let i = 0; i <= close; i++) kinds[i] = "frontmatter";
      start = close + 1;
    }
  }

  let open: { marker: string; indent: string; info: string; line: number } | undefined;
  let afterBlank = true;
  let inList = false;
  let inCode = false;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (open !== undefined) {
      const closer = new RegExp(`^\\s*${open.marker[0] === "`" ? "`" : "~"}{${open.marker.length},}[ \\t]*$`);
      if (closer.test(line)) {
        kinds[i] = "fence-marker";
        fences.push({ start: open.line, end: i + 1, marker: open.marker, indent: open.indent, info: open.info });
        blocks.push({ kind: "fence", start: open.line, end: i + 1 });
        open = undefined;
      } else {
        kinds[i] = "fence";
      }
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      kinds[i] = "fence-marker";
      open = { marker: fence[2] ?? "", indent: fence[1] ?? "", info: (fence[3] ?? "").trim(), line: i + 1 };
      afterBlank = false;
      continue;
    }

    const blank = line.trim() === "";
    if (blank) {
      kinds[i] = "blank";
      afterBlank = true;
      inCode = false;
      continue;
    }

    const indented = INDENTED.test(line);
    if (indented && afterBlank && !inList) inCode = true;
    else if (!indented) inCode = false;
    if (inCode) {
      kinds[i] = "indented-code";
      afterBlank = false;
      continue;
    }

    const atx = ATX.exec(line);
    if (atx !== null) {
      kinds[i] = "heading";
      headings.push({ line: i + 1, level: (atx[1] ?? "").length, text: atx[2] ?? "", setext: false });
      blocks.push({ kind: "heading", start: i + 1, end: i + 1 });
      afterBlank = false;
      inList = false;
      continue;
    }

    // A `=` rule under a paragraph is a setext heading and is reported rather than rewritten; a `-`
    // or `*` rule after a blank line is a thematic break.
    if (SETEXT.test(line) && !afterBlank && kinds[i - 1] === "paragraph") {
      kinds[i] = "setext-underline";
      const text = lines[i - 1] ?? "";
      headings.push({ line: i, level: 1, text: text.trim(), setext: true });
      afterBlank = false;
      continue;
    }

    if (THEMATIC.test(line)) {
      kinds[i] = "thematic-break";
      afterBlank = false;
      inList = false;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      kinds[i] = "blockquote";
      if (kinds[i - 1] !== "blockquote") blocks.push({ kind: "blockquote", start: i + 1, end: i + 1 });
      else {
        const last = blocks.at(-1);
        if (last !== undefined) last.end = i + 1;
      }
      afterBlank = false;
      inList = false;
      continue;
    }

    const next = lines[i + 1];
    if (line.includes("|") && next !== undefined && next.includes("|") && DELIMITER_ROW.test(next)) {
      const indent = /^\s*/.exec(line)?.[0] ?? "";
      const rows: TableRow[] = [
        { line: i + 1, kind: "header", cells: splitTableRow(line) },
        { line: i + 2, kind: "delimiter", cells: splitTableRow(next) },
      ];
      kinds[i] = "table";
      kinds[i + 1] = "table";
      let end = i + 1;
      for (let j = i + 2; j < lines.length; j++) {
        const body = lines[j] ?? "";
        if (body.trim() === "" || !body.includes("|") || FENCE.test(body)) break;
        rows.push({ line: j + 1, kind: "body", cells: splitTableRow(body) });
        kinds[j] = "table";
        end = j;
      }
      tables.push({ start: i + 1, end: end + 1, indent, rows });
      blocks.push({ kind: "table", start: i + 1, end: end + 1 });
      i = end;
      afterBlank = false;
      inList = false;
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item !== null) {
      kinds[i] = "list-item";
      const indent = (item[1] ?? "").length;
      const marker = item[2] ?? "";
      flatItems.push({
        line: i + 1,
        end: i + 1,
        indent,
        marker,
        ordered: /\d/.test(marker),
        contentColumn: indent + marker.length + (item[3] ?? " ").length,
        children: [],
      });
      inList = true;
      afterBlank = false;
      continue;
    }

    if (HTML_BLOCK.test(line)) {
      kinds[i] = "html";
      afterBlank = false;
      continue;
    }

    kinds[i] = "paragraph";
    if (!indented) inList = false;
    afterBlank = false;
  }

  // An item runs to the last line that is blank or indented past its marker, trailing blanks dropped.
  for (const entry of flatItems) {
    let end = entry.line;
    let previousBlank = false;
    for (let j = entry.line; j < lines.length; j++) {
      const line = lines[j] ?? "";
      if (line.trim() === "") {
        previousBlank = true;
        continue;
      }
      const indent = (/^ */.exec(line)?.[0] ?? "").length;
      // A paragraph line at or left of the marker still belongs to the item when no blank line
      // separates them — CommonMark's lazy continuation, which the corpus writes.
      if (indent <= entry.indent && (previousBlank || kinds[j] !== "paragraph")) break;
      previousBlank = false;
      end = j + 1;
    }
    entry.end = end;
  }

  const lists = buildTree(flatItems);
  for (const root of lists) {
    const last = blocks.find((block) => block.kind === "list" && block.end === root.line - 1);
    if (last !== undefined) last.end = root.end;
    else blocks.push({ kind: "list", start: root.line, end: root.end });
  }

  return { lines, kinds, ...(frontmatter === undefined ? {} : { frontmatter }), fences, tables, lists, headings, blocks };
}

function mapOutsideCode(text: string, transform: (part: string) => string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const tick = text.indexOf("`", i);
    if (tick === -1) return out + transform(text.slice(i));
    out += transform(text.slice(i, tick));
    let width = 0;
    while (text[tick + width] === "`") width++;
    const run = "`".repeat(width);
    const close = text.indexOf(run, tick + width);
    // An unclosed run is literal text, so what follows it is still prose.
    if (close === -1) return out + text.slice(tick);
    out += text.slice(tick, close + width);
    i = close + width;
  }
  return out;
}

function normalizeEmphasis(text: string, rule: EmphasisRule): string {
  return mapOutsideCode(text, (part) => {
    const held: string[] = [];
    // Strong spans are held aside so the single-delimiter pass cannot reach inside one.
    const strong = part.replace(STRONG, (_match, _delim: string, inner: string) => {
      held.push(`${rule.strong}${inner}${rule.strong}`);
      return `\uE000${held.length - 1}\uE000`;
    });
    const em = strong.replace(EMPHASIS, (_match, _delim: string, inner: string) => `${rule.em}${inner}${rule.em}`);
    return em.replace(PLACEHOLDER, (_match, index: string) => held[Number(index)] ?? "");
  });
}

function normalizeMarker(line: string, rules: ResolvedMarkdownRules): string {
  const item = LIST_ITEM.exec(line);
  if (item === null) return line;
  const marker = item[2] ?? "";
  const ordered = /\d/.test(marker);
  if (ordered) {
    if (rules.orderedMarker === "off") return line;
    const rewritten = `${marker.slice(0, -1)}${rules.orderedMarker}`;
    return `${item[1] ?? ""}${rewritten}${item[3] ?? ""}${line.slice((item[0] ?? "").length)}`;
  }
  if (rules.bulletMarker === "off") return line;
  return `${item[1] ?? ""}${rules.bulletMarker}${item[3] ?? ""}${line.slice((item[0] ?? "").length)}`;
}

function normalizeFenceMarker(line: string, rules: ResolvedMarkdownRules): string {
  if (rules.fence === "off") return line;
  const fence = FENCE.exec(line);
  if (fence === null) return line;
  const marker = fence[2] ?? "";
  const char = rules.fence.style === "backtick" ? "`" : "~";
  const info = (fence[3] ?? "").trim();
  const alias = rules.fence.aliases[info.split(/\s+/)[0] ?? ""];
  const rewritten = alias === undefined ? info : `${alias}${info.slice((info.split(/\s+/)[0] ?? "").length)}`;
  return `${fence[1] ?? ""}${char.repeat(marker.length)}${rewritten}`;
}

function trimTrailing(line: string, next: string | undefined, rules: ResolvedMarkdownRules): string {
  if (rules.trailingWhitespace === "off") return line;
  const trimmed = line.replace(/[ \t]+$/, "");
  if (trimmed === line) return line;
  const width = rules.trailingWhitespace.allowHardBreak;
  const isHardBreak = width > 0 && line.length - trimmed.length === width && trimmed !== "" && !isBlank(next);
  return isHardBreak ? `${trimmed}${" ".repeat(width)}` : trimmed;
}

/** Whether a line may be rewritten at all — fenced, frontmatter and indented-code bytes are literal. */
function isLiteral(kind: MarkdownLineKind | undefined): boolean {
  return kind === "fence" || kind === "frontmatter" || kind === "indented-code";
}

/** The line rewrites, applied in the order the fixer applies them, so the check and the fixer
 *  cannot disagree about what a clean line looks like. */
function rewriteLine(line: string, kind: MarkdownLineKind, rules: ResolvedMarkdownRules): string {
  let out = line;
  if (rules.hardTabs === "forbid") out = out.replace(/\t/g, "  ");
  if (kind === "fence-marker") return normalizeFenceMarker(out, rules);
  if (kind === "thematic-break" && rules.thematicBreak !== "off") return rules.thematicBreak;
  if (kind === "list-item") out = normalizeMarker(out, rules);
  if (rules.emphasis !== "off") out = normalizeEmphasis(out, rules.emphasis);
  return out;
}

/** The indent every nested item is expected to hold, keyed by its 1-indexed line. */
function desiredIndents(lists: readonly ListItem[], parent: ListItem | undefined, out: Map<number, number>): Map<number, number> {
  for (const item of lists) {
    const desired = parent === undefined ? item.indent : (out.get(parent.line) ?? parent.indent) + (parent.contentColumn - parent.indent);
    out.set(item.line, desired);
    desiredIndents(item.children, item, out);
  }
  return out;
}

function inScope(file: string, scope: readonly string[] | undefined): boolean {
  if (scope === undefined) return true;
  return scope.some((prefix) => file === prefix || file.startsWith(`${prefix}/`));
}

/** The prose of a line with its code spans dropped — a regex or a property path inside backticks is
 *  data, and reading it as markdown is how `theme[a][b]` becomes a reference-style link. */
function prose(text: string): string {
  let out = "";
  mapOutsideCode(text, (part) => {
    out += part;
    return part;
  });
  return out;
}

function strippedOfLinks(text: string): string {
  return prose(text)
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<[^>\s]+>/g, "");
}

/** The blocks missing a blank line on one side, so the check and the fixer read one computation. */
function missingBlankLines(doc: MarkdownDoc, kinds: readonly BlockSpan["kind"][]): { block: BlockSpan; side: "before" | "after" }[] {
  const out: { block: BlockSpan; side: "before" | "after" }[] = [];
  // A block inside a list item is left alone: `- item:` followed by its own fence is the corpus's
  // idiom, and a blank line there would break the item apart.
  const nested = (line: number): boolean => doc.lists.some((root) => line > root.line && line <= root.end);
  for (const block of doc.blocks) {
    if (!kinds.includes(block.kind) || nested(block.start)) continue;
    const opensDocument = block.start === 1 || (doc.frontmatter !== undefined && block.start === doc.frontmatter.end + 1);
    if (!opensDocument && !isBlank(doc.lines[block.start - 2])) out.push({ block, side: "before" });
    if (block.end < doc.lines.length && !isBlank(doc.lines[block.end])) out.push({ block, side: "after" });
  }
  return out;
}

/** Every policy decision the markdown check makes, over one already-parsed document. @public */
export function validateMarkdown(file: string, doc: MarkdownDoc, rules: MarkdownRules = {}): Finding[] {
  const resolved = resolveMarkdownRules(rules);
  const findings: Finding[] = [];
  const fenceLines = new Set(doc.fences.flatMap((fence) => Array.from({ length: fence.end - fence.start + 1 }, (_, i) => fence.start + i)));
  const tableLines = new Set(doc.tables.flatMap((table) => table.rows.map((row) => row.line)));

  for (const [index, line] of doc.lines.entries()) {
    const kind = doc.kinds[index] ?? "paragraph";
    const at = { file, line: index + 1 };
    if (isLiteral(kind)) continue;

    if (resolved.hardTabs === "forbid" && line.includes("\t")) findings.push(fail("hard tab — indent with spaces", at));

    // Compared against the tab-expanded line, so a tab is reported once — by the rule that owns it.
    const expanded = resolved.hardTabs === "forbid" ? line.replace(/\t/g, "  ") : line;
    const rewritten = rewriteLine(expanded, kind, resolved);
    if (rewritten !== expanded) {
      if (kind === "fence-marker") findings.push(fail("code fence: non-canonical marker or language tag", at));
      else if (kind === "thematic-break") findings.push(fail(`thematic break — write it as \`${resolved.thematicBreak}\``, at));
      else if (kind === "list-item" && normalizeMarker(expanded, resolved) !== expanded) {
        const ordered = /^\s*\d/.test(expanded);
        const want = ordered ? `N${resolved.orderedMarker}` : resolved.bulletMarker;
        findings.push(fail(`list marker — write it as \`${want}\``, at));
      } else if (resolved.emphasis !== "off") {
        findings.push(fail(`emphasis — write strong as \`${resolved.emphasis.strong}\` and emphasis as \`${resolved.emphasis.em}\``, at));
      }
    }

    if (trimTrailing(line, doc.lines[index + 1], resolved) !== line) findings.push(fail("trailing whitespace", at));

    if (resolved.linkStyle === "inline" && !fenceLines.has(index + 1)) {
      if (REFERENCE_DEFINITION.test(line) || (REFERENCE_LINK.test(prose(line)) && !line.includes("]("))) {
        findings.push(fail("reference-style link — write the destination inline", at));
      }
    }

    if (resolved.bareUrls !== "off" && !fenceLines.has(index + 1) && BARE_URL.test(strippedOfLinks(line))) {
      findings.push((resolved.bareUrls === "fail" ? fail : warn)("bare URL — wrap it in `<>` or write it as a link", at));
    }

    if (resolved.lineLength !== false && inScope(file, resolved.lineLength.scope)) {
      const { limit, level } = resolved.lineLength;
      if (line.length > limit && !fenceLines.has(index + 1) && !tableLines.has(index + 1)) {
        findings.push((level === "fail" ? fail : warn)(`line is ${line.length} characters, over the ${limit}-column wrap`, at));
      }
    }
  }

  if (resolved.fence !== "off" && resolved.fence.requireLanguage) {
    for (const fence of doc.fences) {
      if (fence.info === "") findings.push(fail("code fence has no language — tag it, e.g. ```ts", { file, line: fence.start }));
    }
  }

  if (resolved.tables === "compact") {
    for (const table of doc.tables) {
      const drifted = table.rows.some((row) => renderTableRow(row, table.indent) !== doc.lines[row.line - 1]);
      if (drifted) findings.push(fail("table is padded — one space per cell side", { file, line: table.start }));
    }
  }

  if (resolved.listIndent === "content-column") {
    const desired = desiredIndents(doc.lists, undefined, new Map());
    for (const [line, indent] of desired) {
      const item = doc.lines[line - 1] ?? "";
      const actual = (/^ */.exec(item)?.[0] ?? "").length;
      if (actual !== indent)
        findings.push(fail(`nested list item is indented ${actual}, not ${indent} — its parent's content column`, { file, line }));
    }
  }

  if (resolved.singleH1) {
    for (const heading of doc.headings.filter((candidate) => candidate.level === 1).slice(1)) {
      findings.push(fail("second level-1 heading — a document has one title", { file, line: heading.line }));
    }
  }

  if (resolved.blankLineAround !== "off") {
    for (const { block, side } of missingBlankLines(doc, resolved.blankLineAround)) {
      findings.push(fail(`blank line missing ${side} this ${block.kind}`, { file, line: side === "before" ? block.start : block.end }));
    }
  }

  if (doc.lines.at(-1) !== "" || doc.lines.at(-2)?.trim() === "") {
    findings.push(fail("file does not end with exactly one newline", { file, line: doc.lines.length }));
  }

  return findings;
}

/** The mechanical half of the rules applied to `doc`'s text. Idempotent: rendering a rendered
 *  document returns it unchanged. Reports nothing — a rule a fixer cannot apply is `validateMarkdown`'s
 *  to raise. @public */
export function renderMarkdown(doc: MarkdownDoc, rules: MarkdownRules = {}): string {
  const resolved = resolveMarkdownRules(rules);
  const out = [...doc.lines];

  for (const [index, line] of out.entries()) {
    const kind = doc.kinds[index] ?? "paragraph";
    if (isLiteral(kind) || kind === "table") continue;
    out[index] = rewriteLine(line, kind, resolved);
  }

  if (resolved.tables === "compact") {
    for (const table of doc.tables) {
      for (const row of table.rows) out[row.line - 1] = renderTableRow(row, table.indent);
    }
  }

  if (resolved.listIndent === "content-column") {
    const desired = desiredIndents(doc.lists, undefined, new Map());
    // Parent first, and a child's own lines withheld from its parent's shift: each item's shift is
    // absolute, so applying both would move a nested item twice.
    for (const item of flattenListItems(doc.lists)) {
      const shift = (desired.get(item.line) ?? item.indent) - item.indent;
      if (shift === 0) continue;
      const owned = new Set(Array.from({ length: item.end - item.line + 1 }, (_, offset) => item.line + offset));
      for (const child of flattenListItems(item.children)) {
        for (let i = child.line; i <= child.end; i++) owned.delete(i);
      }
      for (const i of owned) {
        const text = out[i - 1] ?? "";
        if (text.trim() === "" || isLiteral(doc.kinds[i - 1])) continue;
        out[i - 1] = shift > 0 ? `${" ".repeat(shift)}${text}` : text.slice(Math.min(-shift, (/^ */.exec(text)?.[0] ?? "").length));
      }
    }
  }

  const spaced = resolved.blankLineAround === "off" ? out : insertBlankLines(out, doc, resolved.blankLineAround);

  const trimmed = spaced.map((line, index) => trimTrailing(line, spaced[index + 1], resolved));
  while (trimmed.length > 0 && trimmed.at(-1)?.trim() === "") trimmed.pop();
  return `${trimmed.join("\n")}\n`;
}

function insertBlankLines(lines: readonly string[], doc: MarkdownDoc, kinds: readonly BlockSpan["kind"][]): string[] {
  const before = new Set<number>();
  const after = new Set<number>();
  for (const { block, side } of missingBlankLines(doc, kinds)) {
    if (side === "before") before.add(block.start);
    else after.add(block.end);
  }
  const out: string[] = [];
  for (const [index, line] of lines.entries()) {
    // One blank fills the gap even when the block above asked for one after it and this one asked
    // for one before it — otherwise a fence followed by a list would gain two.
    if (before.has(index + 1) && out.at(-1) !== "") out.push("");
    out.push(line);
    if (after.has(index + 1)) out.push("");
  }
  return out;
}
