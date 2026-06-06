import { createElement, Fragment } from "./element";
import type { JSX } from "./types";

export type { JSX };
export { Fragment };

export function jsxDEV(type: string | ((...args: unknown[]) => unknown), props: Record<string, unknown>, key?: unknown) {
  return createElement(type, props, key);
}
