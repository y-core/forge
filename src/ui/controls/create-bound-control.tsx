/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSXElement } from "../../jsx/types";
import { fieldAttr } from "../server/field-attr";

/** Builds a wrapper around a `ui/core` control that adds a `bind` prop. @internal */
export function createBoundControl<P>(Core: (props: P) => JSXElement | null): FC<P & { bind: string }> {
  // `data-field` and nothing else. The per-control `data-on-*` action is gone: `bindControls`
  // listens once on the scope root, so the markup names the field and the runtime does the rest.
  return ({ bind, ...props }) => <Core {...(props as P)} {...fieldAttr(bind)} />;
}
