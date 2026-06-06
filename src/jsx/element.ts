import type { ComponentFn, JSXElement } from "./types";

/** Fragment renders its children without a wrapper element. @public */
export function Fragment(_: { children?: unknown }): JSXElement | null {
  // Never actually called by renderToString — the renderer detects Fragment by reference
  // equality and renders its children directly. Return type satisfies JSX component constraints.
  return null;
}

/** Creates a JSXElement. Called by the JSX transform (jsx/jsxs/jsxDEV). @public */
export function createElement(type: string | ComponentFn, props: Record<string, unknown> | null, key?: unknown): JSXElement {
  return { type, props: props ?? {}, key, $jsx: true };
}

/** Returns true if `value` is a JSXElement created by this runtime. @public */
export function isValidElement(value: unknown): value is JSXElement {
  return typeof value === "object" && value !== null && (value as { $jsx?: boolean }).$jsx === true;
}

/** Clones a JSXElement, shallow-merging extra props. @public */
export function cloneElement(element: JSXElement, props?: Record<string, unknown>): JSXElement {
  return { ...element, props: { ...element.props, ...(props ?? {}) } };
}
