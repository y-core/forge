/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSXElement } from "../../jsx/types";
import { fieldAttr } from "../server/field-attr";
import { type ScopeAttrsProps, scopeAttrs } from "../server/scope-attrs";

/** The delegated events a bound control listens on. Each maps to a `data-on-<event>` attribute. */
type BoundEvent = "onChange" | "onInput" | "onClick";

/**
 * Build a bound wrapper around a `ui/core` control. The returned component adds a `bind` prop
 * (naming the `SignalRecord` field) plus an optional `action` override, pre-spreading
 * `scopeAttrs({ [event]: action })` + `fieldAttr(bind)` onto the wrapped `Core` for the
 * resumable-scope signal contract. All other props pass through to `Core` unchanged.
 * @internal
 */
export function createBoundControl<P>(
  Core: (props: P) => JSXElement | null,
  opts: { event: BoundEvent; defaultAction: string },
): FC<P & { bind: string; action?: string }> {
  return ({ bind, action = opts.defaultAction, ...props }) => (
    <Core {...(props as P)} {...scopeAttrs({ [opts.event]: action } as ScopeAttrsProps)} {...fieldAttr(bind)} />
  );
}
