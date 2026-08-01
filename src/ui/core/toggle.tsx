/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import { TOGGLE_SCOPE, type ToggleAction } from "../contracts/toggle-contract";
import { scopeAttrs } from "../server/scope-attrs";
import { asClass, cn } from "./utils/cn";

type ToggleProps = Omit<JSX.IntrinsicElements["button"], "children"> & { pressed?: boolean; children?: JSXNode };

const TOGGLE_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium " +
  "bg-transparent text-foreground border border-input cursor-pointer outline-none " +
  "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring " +
  "aria-pressed:bg-primary aria-pressed:text-primary-foreground " +
  "disabled:pointer-events-none disabled:opacity-50";

/**
 * A two-state button.
 *
 * **Three superficially similar controls now exist, and they are not interchangeable.** `Switch` is a
 * form control: it has a `name`, submits a value, and announces as `role="switch"` on a real
 * `<input type="checkbox">`. `ToggleGroup` is a set whose items are reconciled against each other.
 * `Toggle` is neither — a lone button whose pressed state is its own, announced with `aria-pressed`,
 * submitting nothing. Reaching for a Switch when you mean a Toggle puts a checkbox in a form that
 * was never meant to have one.
 *
 * The pressed state flips client-side through the scope registered by `ui/core/client`; without that
 * side-effect import the markup is a static, still-accessible button.
 *
 * The `data-on-click` is emitted by the component, not left to the caller. That scope is lazy, and a
 * lazy scope resumes only on a `data-on-*` interaction — a Toggle without one carries a scope name
 * nothing can ever act on, which is a button that looks wired and is not.
 * @public
 */
export const Toggle: FC<ToggleProps> = ({ pressed = false, class: cls, children, ...rest }) => (
  <button
    type='button'
    data-slot='toggle'
    data-scope={TOGGLE_SCOPE}
    {...scopeAttrs<ToggleAction>({ onClick: "toggle" })}
    aria-pressed={String(pressed) as "true" | "false"}
    {...stateAttrs({ pressed })}
    class={cn(TOGGLE_BASE, asClass(cls))}
    {...rest}>
    {children}
  </button>
);
