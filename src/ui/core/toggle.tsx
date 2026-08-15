/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type ToggleProps = Omit<JSX.IntrinsicElements["input"], "type" | "children"> & { pressed?: boolean; children?: JSXNode };

// Every state hook keys on `:has(:checked)` rather than on an attribute a controller would have to
// maintain, which is what lets the paint stay truthful with no script running at all.
const TOGGLE_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium " +
  "bg-transparent text-foreground border border-input cursor-pointer outline-none " +
  "hover:bg-accent hover:text-accent-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring " +
  "has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary " +
  "has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50";

/** A two-state button backed by a native checkbox, so it toggles and submits with no script. @public */
export const Toggle: FC<ToggleProps> = ({ pressed = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <label data-slot='toggle' class={cn(TOGGLE_BASE, asClass(cls))}>
    {/* `sr-only`, not `hidden`: the input has to stay focusable and stay in the form's submission. */}
    <input data-slot={slotToken("toggle-input", inherited)} type='checkbox' class='sr-only' {...(pressed ? { checked: true } : {})} {...rest} />
    {children}
  </label>
);
