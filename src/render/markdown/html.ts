import { lineAtOffset } from "./source";
import type {
  HtmlAttributes,
  HtmlSchema,
  HtmlWriter,
  MarkdownBlock,
  MarkdownChildLayout,
  MarkdownDefinitionTarget,
  MarkdownDocument,
  MarkdownFootnoteDefinition,
  MarkdownInline,
  MarkdownListInfo,
  MarkdownNode,
  MarkdownNodeHandler,
  MarkdownNodeHandlers,
  MarkdownRenderContext,
  MarkdownRenderOptions,
  MarkdownTable,
  MarkdownTableRow,
  MarkdownUnit,
  WalkNode,
} from "./types";
import { walkTree } from "./walk";

const VOID_ELEMENTS: ReadonlySet<string> = new Set(["br", "hr", "img", "input"]);

function escapeText(value: string): string {
  let out = "";
  let flushed = 0;
  for (let at = 0; at < value.length; at++) {
    const code = value.charCodeAt(at);
    if (code !== 0x26 && code !== 0x3c) continue;
    out += value.slice(flushed, at) + (code === 0x26 ? "&#x26;" : "&#x3C;");
    flushed = at + 1;
  }
  return flushed === 0 ? value : out + value.slice(flushed);
}

// `<` and `>` go beyond hast-util-to-html's set: an attribute inside a raw-text element is closed by a literal `</`.
function escapeAttribute(value: string): string {
  let out = "";
  let flushed = 0;
  for (let at = 0; at < value.length; at++) {
    const code = value.charCodeAt(at);
    if (code !== 0x26 && code !== 0x22 && code !== 0x27 && code !== 0x60 && code !== 0x3c && code !== 0x3e) continue;
    out += value.slice(flushed, at) + `&#x${code.toString(16)};`;
    flushed = at + 1;
  }
  return flushed === 0 ? value : out + value.slice(flushed);
}

/** Creates a writer that emits only what `schema` allows. */
export function createHtmlWriter(schema: HtmlSchema): HtmlWriter {
  const chunks: string[] = [];
  const open: (string | null)[] = [];

  function writeOpen(key: string, attributes: HtmlAttributes): string | null {
    const rule = schema.elements[key];
    if (rule === undefined) return null;
    const tag = rule.tag ?? key;
    let markup = `<${tag}`;
    const kept = new Set<string>();
    for (const [name, value] of attributes) {
      if (value === false || !(rule.attributes ?? []).includes(name)) continue;
      if (value === true) {
        markup += ` ${name}`;
        kept.add(name);
        continue;
      }
      const checked = (rule.urls ?? []).includes(name) ? schema.url({ value, attribute: name, tag }) : value;
      if (checked === null || rule.patterns?.[name]?.test(checked) === false) continue;
      markup += ` ${name}="${escapeAttribute(checked)}"`;
      kept.add(name);
    }
    if ((rule.requires ?? []).some((name) => !kept.has(name))) return null;
    chunks.push(markup + ">");
    return tag;
  }

  return {
    open(key, attributes = []) {
      open.push(writeOpen(key, attributes));
    },
    close() {
      const tag = open.pop();
      if (tag !== null && tag !== undefined && !VOID_ELEMENTS.has(tag)) chunks.push(`</${tag}>`);
    },
    text(value) {
      if (value !== "") chunks.push(escapeText(value));
    },
    mark: () => chunks.length,
    rewind(mark) {
      chunks.length = mark;
    },
    html: () => chunks.join(""),
  };
}

const URL_SAFE = /[!#$&-;=?-Z_a-z~]/;

function isAsciiAlphanumeric(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** Percent-encodes what a URL may not carry raw, keeping existing `%XX` escapes, exactly as micromark's `normalizeUri` does. @internal */
export function normalizeUrl(value: string): string {
  let out = "";
  let flushed = 0;
  for (let at = 0; at < value.length; at++) {
    const code = value.charCodeAt(at);
    let replace = "";
    let skip = 0;
    if (code === 0x25 && isAsciiAlphanumeric(value.charCodeAt(at + 1)) && isAsciiAlphanumeric(value.charCodeAt(at + 2))) skip = 2;
    else if (code < 128) {
      if (!URL_SAFE.test(String.fromCharCode(code))) replace = String.fromCharCode(code);
    } else if (code >= 0xd800 && code <= 0xdfff) {
      const next = value.charCodeAt(at + 1);
      if (code < 0xdc00 && next >= 0xdc00 && next <= 0xdfff) {
        replace = String.fromCharCode(code, next);
        skip = 1;
      } else replace = "\u{fffd}";
    } else replace = String.fromCharCode(code);
    if (replace !== "") {
      out += value.slice(flushed, at) + encodeURIComponent(replace);
      flushed = at + skip + 1;
    }
    at += skip;
  }
  return flushed === 0 ? value : out + value.slice(flushed);
}

function childrenOf(node: MarkdownNode): readonly MarkdownNode[] | null {
  return "children" in node ? (node.children as readonly MarkdownNode[]) : null;
}

/** Returns the plain text of inline nodes: text and code values, with images contributing their own alt text. */
export function inlinePlainText(nodes: readonly MarkdownInline[]): string {
  let text = "";
  const stack: MarkdownInline[] = [...nodes].reverse();
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.type === "text" || node.type === "inlineCode") text += node.value;
    else if ("children" in node) for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index] as MarkdownInline);
  }
  return text;
}

const TRIM_LINES = /[ \t]*(\r\n|\r|\n)[ \t]*/g;
const LINE_ENDING = /\r\n|\r|\n/g;
const TRAILING_LINE_ENDING = /(?:\r\n|\r|\n)$/;

function writeElement(tag: string, attributes: HtmlAttributes = []): MarkdownNodeHandler {
  return { enter: (_node, { writer }) => writer.open(tag, attributes), leave: (_node, { writer }) => writer.close(), layout: "inline" };
}

function headingTag(node: MarkdownNode): string {
  return node.type === "heading" ? `h${node.depth}` : "p";
}

/** The CommonMark renderings every node type falls back to. @internal */
export const DEFAULT_HANDLERS: MarkdownNodeHandlers = {
  paragraph: {
    enter: (node, context) => {
      const { writer, tight, task } = context;
      if (!tight) writer.open("p");
      if (task === null) return;
      context.task = null;
      writer.open("input", [
        ["type", "checkbox"],
        ["checked", task],
        ["disabled", true],
      ]);
      writer.close();
      if (node.type === "paragraph" && node.children.length > 0) writer.text(" ");
    },
    leave: (_node, { writer, tight }) => {
      if (!tight) writer.close();
    },
    layout: "inline",
  },
  heading: { enter: (node, { writer }) => writer.open(headingTag(node)), leave: (_node, { writer }) => writer.close(), layout: "inline" },
  thematicBreak: {
    enter: (_node, { writer }) => {
      writer.open("hr");
      writer.close();
    },
  },
  blockquote: { ...writeElement("blockquote"), layout: "loose" },
  code: {
    enter: (node, { writer, document, unit }) => {
      if (node.type !== "code") return;
      writer.open("pre");
      writer.open("code", node.lang === null ? [] : [["class", `language-${node.lang}`]]);
      const value = codeBlockText(document.source, unit.start, node.segments);
      writer.text(value === "" ? "" : value + "\n");
      writer.close();
      writer.close();
    },
  },
  list: {
    enter: (node, { writer }) => {
      if (node.type === "list") openList(writer, node, node.children);
    },
    leave: (_node, { writer }) => writer.close(),
    layout: "loose",
  },
  definition: { enter: () => undefined },
  footnoteDefinition: { enter: () => undefined, children: () => null },
  text: {
    enter: (node, { writer }) => {
      if (node.type === "text") writer.text(node.value.replace(TRIM_LINES, "$1"));
    },
  },
  inlineCode: {
    enter: (node, { writer }) => {
      if (node.type !== "inlineCode") return;
      writer.open("code");
      writer.text(node.value.replace(LINE_ENDING, " "));
      writer.close();
    },
  },
  break: {
    enter: (_node, { writer }) => {
      writer.open("br");
      writer.close();
      writer.text("\n");
    },
  },
  emphasis: writeElement("em"),
  strong: writeElement("strong"),
  delete: writeElement("del"),
  link: {
    enter: (node, { writer }) => {
      if (node.type !== "link") return;
      writer.open("a", [["href", normalizeUrl(node.url)], ...titleAttribute(node.title)]);
    },
    leave: (_node, { writer }) => writer.close(),
    layout: "inline",
  },
  image: {
    enter: (node, { writer }) => {
      if (node.type !== "image") return;
      writer.open("img", [["src", normalizeUrl(node.url)], ["alt", inlinePlainText(node.children)], ...titleAttribute(node.title)]);
      writer.close();
    },
    children: () => null,
  },
};

function titleAttribute(title: string | null): HtmlAttributes {
  return title === null ? [] : [["title", title]];
}

function openList(writer: HtmlWriter, list: MarkdownListInfo, items: readonly MarkdownBlock[]): void {
  const start: HtmlAttributes = list.ordered && list.firstNumber !== 1 && list.firstNumber !== null ? [["start", String(list.firstNumber)]] : [];
  const tasks: HtmlAttributes = items.some((item) => item.type === "listItem" && item.checked !== null) ? [["class", "contains-task-list"]] : [];
  writer.open(list.ordered ? "ol" : "ul", [...start, ...tasks]);
}

/** Returns a code block's text as micromark reads it: each line with the line ending written after it, less one trailing ending. */
export function codeBlockText(source: string, base: number, segments: readonly number[]): string {
  let text = "";
  for (let index = 0; index < segments.length; index += 3) {
    const end = base + (segments[index + 1] ?? 0);
    const ending =
      source.charCodeAt(end) === 0x0d ? (source.charCodeAt(end + 1) === 0x0a ? "\r\n" : "\r") : source.charCodeAt(end) === 0x0a ? "\n" : "";
    text += " ".repeat(segments[index + 2] ?? 0) + source.slice(base + (segments[index] ?? 0), end) + ending;
  }
  return text.replace(TRAILING_LINE_ENDING, "").replaceAll("\u0000", "\u{fffd}");
}

interface Frame {
  node: MarkdownNode;
  handler: MarkdownNodeHandler | null;
  children: readonly MarkdownNode[];
  index: number;
  layout: MarkdownChildLayout | "item";
  task: boolean | null;
  entryTight: boolean;
  childTight: boolean;
  rendered: number;
  lastType: string;
  childType: string;
  separator: number;
  childStart: number;
}

function createAnchoredWriter(writer: HtmlWriter, line: number): HtmlWriter {
  let anchored = false;
  return {
    ...writer,
    open(tag, attributes = []) {
      if (anchored) return writer.open(tag, attributes);
      anchored = true;
      writer.open(tag, [...attributes, ["data-line", String(line)]]);
    },
  };
}

function renameClasses(writer: HtmlWriter, classNames: Readonly<Record<string, string | null>> | undefined): HtmlWriter {
  if (classNames === undefined) return writer;
  const rename = (value: string) =>
    value
      .split(" ")
      .map((name) => (Object.hasOwn(classNames, name) ? classNames[name] : name))
      .filter((name): name is string => name !== null && name !== undefined)
      .join(" ");
  return {
    ...writer,
    open(tag, attributes = []) {
      writer.open(
        tag,
        attributes.flatMap(([name, value]): HtmlAttributes => {
          if (name !== "class" || typeof value !== "string") return [[name, value]];
          const renamed = rename(value);
          return renamed === "" ? [] : [[name, renamed]];
        }),
      );
    },
  };
}

function createRenderer(document: MarkdownDocument, options: MarkdownRenderOptions) {
  const writer = renameClasses(createHtmlWriter(options.schema), options.classNames);
  const referenceBudget = Math.max(64 * 1024, 2 * document.source.length);
  let referenceSpent = 0;
  const openedReferences: boolean[] = [];
  const footnoteOptions = options.footnotes ?? {};
  const idPrefix = footnoteOptions.idPrefix ?? "user-content-";
  const labelId = footnoteOptions.labelId ?? "footnote-label";
  const footnoteFlag: string | boolean = footnoteOptions.emptyFlagValues === true ? "" : true;
  const footnoteDefinitions = collectFootnoteDefinitions(document);
  const footnoteOrder: string[] = [];
  const footnoteNumbers = new Map<string, number>();
  const footnoteCounts = new Map<string, number>();
  let paddingBudget = document.source.length;
  let currentUnit: MarkdownUnit | null = null;

  function resolveReference(label: string): MarkdownDefinitionTarget | null {
    const target = document.definitions.get(label);
    if (target === undefined) return null;
    referenceSpent += target.url.length + (target.title?.length ?? 0);
    return referenceSpent > referenceBudget ? null : target;
  }

  const handlers: MarkdownNodeHandlers = {
    ...DEFAULT_HANDLERS,
    linkReference: {
      enter: (node, { writer: out }) => {
        const target = node.type === "linkReference" ? resolveReference(node.label) : null;
        openedReferences.push(target !== null);
        if (target !== null) out.open("a", [["href", normalizeUrl(target.url)], ...titleAttribute(target.title)]);
      },
      leave: (_node, { writer: out }) => {
        if (openedReferences.pop() === true) out.close();
      },
      layout: "inline",
    },
    footnoteReference: {
      enter: (node, { writer: out }) => {
        if (node.type !== "footnoteReference") return;
        let number = footnoteNumbers.get(node.label);
        if (number === undefined) {
          footnoteOrder.push(node.label);
          number = footnoteOrder.length;
          footnoteNumbers.set(node.label, number);
        }
        const count = (footnoteCounts.get(node.label) ?? 0) + 1;
        footnoteCounts.set(node.label, count);
        const id = footnoteId(node.label);
        out.open("sup");
        out.open("a", [
          ["href", `#${idPrefix}fn-${id}`],
          ["id", `${idPrefix}fnref-${id}${count > 1 ? `-${count}` : ""}`],
          ["data-footnote-ref", footnoteFlag],
          ["aria-describedby", labelId],
        ]);
        out.text(String(number));
        out.close();
        out.close();
      },
    },
    table: {
      enter: (node, context) => {
        if (node.type === "table") renderTable(node, context);
      },
      children: () => null,
    },
    imageReference: {
      enter: (node, { writer: out }) => {
        if (node.type !== "imageReference") return;
        const target = resolveReference(node.label);
        if (target === null) {
          out.text(inlinePlainText(node.children));
          return;
        }
        out.open("img", [["src", normalizeUrl(target.url)], ["alt", inlinePlainText(node.children)], ...titleAttribute(target.title)]);
        out.close();
      },
      children: () => null,
    },
    ...options.handlers,
  };

  function createFrame(
    node: MarkdownNode,
    handler: MarkdownNodeHandler | null,
    children: readonly MarkdownNode[],
    layout: Frame["layout"],
    entryTight: boolean,
    childTight: boolean,
  ): Frame {
    return {
      node,
      handler,
      children,
      index: 0,
      layout,
      task: null,
      entryTight,
      childTight,
      rendered: 0,
      lastType: "",
      childType: "",
      separator: -1,
      childStart: 0,
    };
  }

  function renderRow(row: MarkdownTableRow | undefined, align: MarkdownTable["align"], tag: string, context: MarkdownRenderContext): void {
    const out = context.writer;
    out.open("tr");
    out.text("\n");
    for (let index = 0; index < align.length; index++) {
      const cell = row?.children[index];
      if (cell === undefined) {
        if (paddingBudget <= 0) break;
        paddingBudget--;
      }
      if (index > 0) out.text("\n");
      const alignment = align[index];
      out.open(tag, alignment === null || alignment === undefined ? [] : [["align", alignment]]);
      for (const child of cell?.children ?? []) context.render(child);
      out.close();
    }
    out.text("\n");
    out.close();
  }

  function renderTable(table: MarkdownTable, context: MarkdownRenderContext): void {
    const out = context.writer;
    const [head, ...body] = table.children;
    out.open("table");
    out.text("\n");
    out.open("thead");
    out.text("\n");
    renderRow(head, table.align, "th", context);
    out.text("\n");
    out.close();
    if (body.length > 0) {
      out.text("\n");
      out.open("tbody");
      out.text("\n");
      body.forEach((row, index) => {
        if (index > 0) out.text("\n");
        renderRow(row, table.align, "td", context);
      });
      out.text("\n");
      out.close();
    }
    out.text("\n");
    out.close();
  }

  function enter(node: MarkdownNode, context: MarkdownRenderContext, frames: Frame[], tight: boolean): void {
    context.tight = tight;
    if (node.type === "listItem") {
      context.writer.open("li", node.checked === null ? [] : [["class", "task-list-item"]]);
      const frame = createFrame(node, null, node.children, "item", tight, tight);
      frame.task = node.checked;
      frames.push(frame);
      return;
    }
    const handler = handlers[node.type];
    if (handler === undefined) throw new Error(`renderMarkdownHtml: no handler for a \`${node.type}\` node.`);
    handler.enter(node, context);
    const children = handler.children === undefined ? childrenOf(node) : handler.children(node, context);
    const layout = handler.layout ?? "inline";
    if (layout === "loose") context.writer.text("\n");
    if (children !== null || handler.leave !== undefined) frames.push(createFrame(node, handler, children ?? [], layout, tight, false));
  }

  function startChild(frame: Frame, child: MarkdownNode): void {
    frame.separator = writer.mark();
    const itemSeparator = frame.layout === "item" && (!frame.childTight || frame.rendered > 0 || child.type !== "paragraph");
    if (itemSeparator || (frame.layout !== "inline" && frame.layout !== "item" && frame.rendered > 0)) writer.text("\n");
    frame.childStart = writer.mark();
    frame.childType = child.type;
  }

  function finishChild(frame: Frame): void {
    if (frame.separator < 0) return;
    if (writer.mark() === frame.childStart) writer.rewind(frame.separator);
    else {
      frame.rendered++;
      frame.lastType = frame.childType;
    }
    frame.separator = -1;
  }

  function leave(frame: Frame, context: MarkdownRenderContext): void {
    context.tight = frame.entryTight;
    if (frame.layout === "item") {
      if (frame.rendered > 0 && (!frame.childTight || frame.lastType !== "paragraph")) context.writer.text("\n");
      context.writer.close();
      return;
    }
    if (frame.layout === "loose" && frame.rendered > 0) context.writer.text("\n");
    frame.handler?.leave?.(frame.node, context);
  }

  function childTightness(frame: Frame, child: MarkdownNode): boolean {
    if (child.type === "listItem") return frame.node.type === "list" && !frame.node.spread;
    return frame.layout === "item" && frame.childTight;
  }

  function renderNode(root: MarkdownNode, unit: MarkdownUnit, tight: boolean, anchor: boolean): void {
    const line = root === unit.node && unit.start > 0 ? unit.line : lineAtOffset(document.lineStarts, unit.start + root.start);
    const out = anchor ? createAnchoredWriter(writer, line) : writer;
    currentUnit = unit;
    const context: MarkdownRenderContext = { writer: out, document, unit, tight, topLevel: anchor, line, task: null, render: renderInline };
    const frames: Frame[] = [];
    enter(root, context, frames, tight);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1] as Frame;
      finishChild(frame);
      const child = frame.children[frame.index];
      if (child === undefined) {
        frames.pop();
        leave(frame, context);
        continue;
      }
      frame.index++;
      startChild(frame, child);
      context.topLevel = false;
      context.task = frame.layout === "item" && frame.index === 1 ? frame.task : null;
      enter(child, context, frames, childTightness(frame, child));
      context.task = null;
    }
  }

  function renderInline(node: MarkdownNode): void {
    if (currentUnit !== null) renderNode(node, currentUnit, false, false);
  }

  function renderList(units: readonly MarkdownUnit[], from: number, anchor: boolean): number {
    const first = units[from] as MarkdownUnit;
    const list = first.list as MarkdownListInfo;
    const out = anchor ? createAnchoredWriter(writer, lineAtOffset(document.lineStarts, first.start + first.node.start)) : writer;
    const items: MarkdownBlock[] = [];
    for (let index = from; units[index]?.list === list; index++) items.push((units[index] as MarkdownUnit).node);
    openList(out, list, items);
    out.text("\n");
    let index = from;
    for (; units[index]?.list === list; index++) {
      if (index > from) out.text("\n");
      const item = units[index] as MarkdownUnit;
      renderNode(item.node, item, !list.spread, false);
    }
    out.text("\n");
    out.close();
    return index;
  }

  function renderUnits(): string {
    const units = document.units;
    const anchor = options.lineAnchors === true;
    let rendered = 0;
    for (let index = 0; index < units.length;) {
      const unit = units[index] as MarkdownUnit;
      const before = writer.mark();
      if (rendered > 0) writer.text("\n");
      const start = writer.mark();
      if (unit.list === undefined) {
        renderNode(unit.node, unit, false, anchor);
        index++;
      } else index = renderList(units, index, anchor);
      if (writer.mark() === start) writer.rewind(before);
      else rendered++;
    }
    renderFootnotes();
    return writer.html();
  }

  function footnoteId(label: string): string {
    return normalizeUrl(label.toLowerCase());
  }

  function writeBackReference(label: string, number: number, repeat: number): void {
    const suffix = repeat > 1 ? `-${repeat}` : "";
    writer.open("a", [
      ["href", `#${idPrefix}fnref-${footnoteId(label)}${suffix}`],
      ["data-footnote-backref", ""],
      ["aria-label", `Back to reference ${number}${suffix}`],
      ["class", "data-footnote-backref"],
    ]);
    writer.text("\u21a9");
    if (repeat > 1) {
      writer.open("sup");
      writer.text(String(repeat));
      writer.close();
    }
    writer.close();
  }

  function renderFootnoteItem(label: string, number: number, definition: MarkdownFootnoteDefinition, unit: MarkdownUnit): void {
    writer.open("li", [["id", `${idPrefix}fn-${footnoteId(label)}`]]);
    writer.text("\n");
    const rendered = definition.children.filter((child) => child.type !== "definition" && child.type !== "footnoteDefinition");
    const tail = rendered.at(-1);
    let written = 0;
    for (const child of rendered) {
      if (written > 0) writer.text("\n");
      if (child === tail && child.type === "paragraph") {
        writer.open("p");
        for (const inline of child.children) renderNode(inline, unit, false, false);
        writer.text(" ");
        const count = footnoteCounts.get(label) ?? 0;
        for (let repeat = 1; repeat <= count; repeat++) {
          if (repeat > 1) writer.text(" ");
          writeBackReference(label, number, repeat);
        }
        writer.close();
      } else renderNode(child, unit, false, false);
      written++;
    }
    if (tail?.type !== "paragraph") {
      const count = footnoteCounts.get(label) ?? 0;
      for (let repeat = 1; repeat <= count; repeat++) {
        if (written > 0) writer.text("\n");
        if (repeat > 1) writer.text(" \n");
        writeBackReference(label, number, repeat);
        written++;
      }
    }
    writer.text("\n");
    writer.close();
  }

  function renderFootnotes(): void {
    if (footnoteOrder.length === 0) return;
    writer.text("\n");
    writer.open("section", [
      ["data-footnotes", footnoteFlag],
      ["class", "footnotes"],
    ]);
    writer.open("h2", [
      ["class", "sr-only"],
      ["id", labelId],
    ]);
    writer.text("Footnotes");
    writer.close();
    writer.text("\n");
    writer.open("ol");
    writer.text("\n");
    for (let index = 0; index < footnoteOrder.length; index++) {
      const label = footnoteOrder[index] as string;
      const found = footnoteDefinitions.get(label);
      if (found === undefined) continue;
      if (index > 0) writer.text("\n");
      renderFootnoteItem(label, index + 1, found.definition, found.unit);
    }
    writer.text("\n");
    writer.close();
    writer.text("\n");
    writer.close();
  }

  return { renderUnits };
}

const INLINE_LEAVES: ReadonlySet<string> = new Set(["paragraph", "heading", "table"]);

// Any block may hold a footnote definition, a dialect's container blocks included, so every container is entered.
function collectFootnoteDefinitions(document: MarkdownDocument): Map<string, { definition: MarkdownFootnoteDefinition; unit: MarkdownUnit }> {
  const found = new Map<string, { definition: MarkdownFootnoteDefinition; unit: MarkdownUnit }>();
  if (document.footnoteDefinitions.size === 0) return found;
  for (const unit of document.units) {
    walkTree<WalkNode>(unit.node, (node) => {
      if (node.type === "footnoteDefinition") {
        const definition = node as MarkdownFootnoteDefinition;
        if (!found.has(definition.label)) found.set(definition.label, { definition, unit });
      }
      return !INLINE_LEAVES.has(node.type);
    });
  }
  return found;
}

/** Renders a parsed document to HTML through a schema-bound writer, with per-type handlers overriding the CommonMark defaults. */
export function renderMarkdownHtml(document: MarkdownDocument, options: MarkdownRenderOptions): string {
  return createRenderer(document, options).renderUnits();
}
