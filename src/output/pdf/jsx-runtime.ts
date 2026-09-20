import type { PdfElement } from "./types";

export { Fragment, jsx, jsxs } from "../../jsx/jsx-runtime";

// Named `JSX` because the transform resolves the namespace by name, and separate from `jsx`'s own
// because widening that one to admit a `PdfElement` would admit one into `renderToString` too.
export declare namespace JSX {
  /** What a JSX expression evaluates to here: the descriptor `jsx()` builds, which `toPdfElements` lowers. */
  interface Element {
    type: unknown;
    props: Record<string, unknown>;
  }

  /** What may stand in element position: a component answering with a `PdfElement`, and nothing else. */
  type ElementType = (props: never) => PdfElement;

  interface ElementChildrenAttribute {
    // oxlint-disable-next-line typescript/no-empty-object-type -- TypeScript JSX convention — {} is required by the spec to declare the children slot
    children: {};
  }

  interface ElementAttributesProperty {
    // oxlint-disable-next-line typescript/no-empty-object-type -- TypeScript JSX convention — {} is required by the spec to declare the props slot
    props: {};
  }

  interface IntrinsicAttributes {
    key?: unknown | undefined;
  }

  /** Empty on purpose: a page has no host elements, so `<div>` is a mistake rather than a fallback. */
  // oxlint-disable-next-line typescript/no-empty-object-type -- the absence of host elements is the declaration
  interface IntrinsicElements {}
}
