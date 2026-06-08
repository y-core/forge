import { createElement, Fragment } from "./element";

/** Classic-runtime fallback factory: folds variadic children into props.children. */
function h(type: string | ((...a: unknown[]) => unknown), props?: Record<string, unknown> | null, ...children: unknown[]) {
  const merged: Record<string, unknown> = { ...(props ?? {}) };
  if (children.length === 1) merged.children = children[0];
  else if (children.length > 1) merged.children = children;
  return createElement(type as never, merged);
}

// esbuild's zero-config fallback emits `React.createElement` / `React.Fragment`.
// Shimming the React global makes that path resolve to forge's runtime. @public
(globalThis as { React?: unknown }).React = { createElement: h, Fragment };
