import type { ComponentFn, JSXElement } from "./types";

const JSX_BRAND = Symbol("forge.jsx");

/** Fragment renders its children without a wrapper element. @public */
export function Fragment(_: { children?: unknown }): JSXElement | null {
  // Never called: renderToString detects Fragment by reference equality and renders its children.
  return null;
}

/** Creates a JSXElement. Called by the JSX transform (jsx/jsxs/jsxDEV). @public */
export function createElement(type: string | ComponentFn, props: Record<string, unknown> | null, key?: unknown): JSXElement {
  return { type, props: props ?? {}, key, [JSX_BRAND]: true } as unknown as JSXElement;
}

/** Returns true if `value` is a JSXElement created by this runtime. @public */
export function isValidElement(value: unknown): value is JSXElement {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[JSX_BRAND] === true;
}

/** Clones a JSXElement, shallow-merging extra props. @public */
export function cloneElement(element: JSXElement, props?: Record<string, unknown>): JSXElement {
  // The spread carries the brand: object spread copies enumerable symbol keys.
  return { ...element, props: { ...element.props, ...props } };
}
