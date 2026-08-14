/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSXElement } from "../../jsx/types";
import { type ScopeAttrsProps, scopeAttrs } from "../contracts/scope-attrs";
import { fieldAttr } from "../server/field-attr";

/** The delegated events a bound control listens on. */
type BoundEvent = "onChange" | "onInput" | "onClick";

/** Builds a wrapper around a `ui/core` control that adds `bind` and optional `action` props. @internal */
export function createBoundControl<P>(
  Core: (props: P) => JSXElement | null,
  opts: { event: BoundEvent; defaultAction: string },
): FC<P & { bind: string; action?: string }> {
  return ({ bind, action = opts.defaultAction, ...props }) => (
    <Core {...(props as P)} {...scopeAttrs({ [opts.event]: action } as ScopeAttrsProps)} {...fieldAttr(bind)} />
  );
}
