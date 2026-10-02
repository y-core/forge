import { parseDialect } from "../../dialect.fixture";
import type { MarkdownNode } from "../../types";
import { walkMarkdown } from "../../walk";
import type { DialectSpan, ViewportDialect } from "./types";

const ID_TARGET = /^(?:s:|nb:)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:#.+)?$/i;

/** The callout kinds the test dialect reads. */
export const TEST_CALLOUT_KINDS: readonly string[] = ["note", "tip", "warning", "danger", "conflict"];

function wikiLinkParts(inner: string): { readonly target: string; readonly label: string | undefined; readonly pipe: number } {
  const pipe = inner.indexOf("|");
  if (pipe === -1) return { target: inner, label: undefined, pipe };
  const escaped = inner[pipe - 1] === "\\";
  return { target: inner.slice(0, escaped ? pipe - 1 : pipe), label: inner.slice(pipe + 1), pipe };
}

function spanOf(node: MarkdownNode, text: string, base: number): DialectSpan | undefined {
  const from = base + node.start;
  const to = base + node.end;
  if (node.type === "tag") return { kind: "tag", from, to };
  if (node.type === "highlight") return { kind: "highlight", from, to };
  if (node.type === "taskDue") return { kind: "due", from, to };
  if (node.type === "embed") return { kind: "embed", from, to, alt: node.alt || "Attachment" };
  if (node.type !== "wikiLink") return undefined;
  const { target, label, pipe } = wikiLinkParts(text.slice(from, to).slice(2, -2));
  const labelFrom = pipe === -1 ? from + 2 : from + 2 + pipe + 1;
  return { kind: "wikilink", from, to, labelFrom, chip: ID_TARGET.test(target.trim()) ? { label: label || target, target } : undefined };
}

/** Every dialect span forge's markdown constructs find in a unit, a wiki link to an id-form target drawn as a chip. */
export function testDialectSpans(text: string): DialectSpan[] {
  const spans: DialectSpan[] = [];
  walkMarkdown(parseDialect(text), (node, { base }) => {
    const span = spanOf(node, text, base);
    if (span !== undefined) spans.push(span);
    return undefined;
  });
  return spans;
}

/** A viewport dialect built on forge's markdown constructs, as an app builds its own. */
export const TEST_DIALECT: ViewportDialect = { spans: testDialectSpans, calloutKinds: TEST_CALLOUT_KINDS };
