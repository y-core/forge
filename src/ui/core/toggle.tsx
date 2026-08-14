/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { scopeAttrs } from "../contracts/scope-attrs";
import { stateAttrs } from "../contracts/state-attrs";
import { TOGGLE_SCOPE, type ToggleAction } from "../contracts/toggle-contract";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type ToggleProps = Omit<JSX.IntrinsicElements["button"], "children"> & { pressed?: boolean; children?: JSXNode };

const TOGGLE_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium " +
  "bg-transparent text-foreground border border-input cursor-pointer outline-none " +
  "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring " +
  "aria-pressed:bg-primary aria-pressed:text-primary-foreground " +
  "disabled:pointer-events-none disabled:opacity-50";

/** A lone two-state button whose pressed state is announced with `aria-pressed` and submits nothing. @public */
export const Toggle: FC<ToggleProps> = ({ pressed = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <button
    type='button'
    data-slot={slotToken("toggle", inherited)}
    data-scope={TOGGLE_SCOPE}
    {...scopeAttrs<ToggleAction>({ onClick: "toggle" })}
    aria-pressed={pressed}
    {...stateAttrs({ pressed })}
    class={cn(TOGGLE_BASE, asClass(cls))}
    {...rest}>
    {children}
  </button>
);
