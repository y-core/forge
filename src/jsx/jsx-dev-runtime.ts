import { createElement, Fragment } from "./element";
import type { JSX } from "./types";

export type { JSX };
export { Fragment };

/** Development-mode JSX factory the TypeScript transform calls in place of `jsx`. @public */
export function jsxDEV(type: string | ((...args: unknown[]) => unknown), props: Record<string, unknown>, key?: unknown) {
  return createElement(type, props, key);
}
