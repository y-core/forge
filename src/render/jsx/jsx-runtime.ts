import { createElement, Fragment } from "./element";
import type { JSX } from "./types";

export type { JSX };
export { Fragment };

/** Automatic-runtime JSX factory the TypeScript transform calls for every element. @public */
export function jsx(type: string | ((...args: unknown[]) => unknown), props: Record<string, unknown>, key?: unknown) {
  return createElement(type, props, key);
}

export const jsxs = jsx;
