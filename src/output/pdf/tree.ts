import { Fragment } from "../../jsx/jsx-runtime";
import type { PdfContent, PdfElement } from "./types";

interface Descriptor {
  type: unknown;
  props: Record<string, unknown>;
}

function isElement(value: unknown): value is PdfElement {
  return typeof value === "object" && value !== null && typeof (value as PdfElement).fragments === "function";
}

function isDescriptor(value: unknown): value is Descriptor {
  return typeof value === "object" && value !== null && "type" in value && "props" in value;
}

function isText(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

// A component whose children are words takes them as its own text; one whose children are elements
// takes them lowered. Deciding here is what lets `Heading` and `Stack` share a single call shape.
function loweredChildren(raw: unknown): unknown {
  if (isText(raw)) return String(raw);
  if (Array.isArray(raw) && raw.length > 0 && raw.every(isText)) return raw.map(String).join("");
  return toPdfElements(raw as PdfContent);
}

/** A tree of components — factory calls, JSX descriptors, fragments and arrays — flattened to elements. @public */
export function toPdfElements(content: PdfContent): PdfElement[] {
  if (content === null || content === undefined || typeof content === "boolean") return [];
  if (Array.isArray(content)) return content.flatMap((child) => toPdfElements(child as PdfContent));
  if (isElement(content)) return [content];
  if (!isDescriptor(content)) return [];

  const { type, props } = content;
  const children = loweredChildren(props.children);
  // A fragment has no component of its own: the transform emits it as the marker, so its children
  // are the whole of it.
  if (type === Fragment) return Array.isArray(children) ? (children as PdfElement[]) : [];
  if (typeof type !== "function") return [];
  const built = (type as (given: Record<string, unknown>) => unknown)({ ...props, children });
  return toPdfElements(built as PdfContent);
}
