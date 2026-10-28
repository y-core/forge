/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import type { FC, JSX, JSXNode } from "../../render/jsx/types";
import type { Size } from "../contracts/types";
import { presentationAttrs } from "../contracts/vocabulary";
import { buttonBox } from "./button";
import { fieldStateProps } from "./field";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { PRESSED_PAINT } from "./utils/recipes";

type ToggleProps = Omit<JSX.IntrinsicElements["input"], "children" | "size" | "type"> & {
  pressed?: boolean | undefined;
  size?: Size | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
  children?: JSXNode | undefined;
};

// Every state hook keys on `:has(:checked)` rather than on an attribute a controller would have to
// maintain, which is what lets the paint stay truthful with no script running at all.
const TOGGLE_PAINT = cn(
  "state-invalid border-input bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
  PRESSED_PAINT,
  "cursor-pointer",
);

/** A two-state button backed by a native checkbox, so it toggles and submits with no script. @public */
export const Toggle: FC<ToggleProps> = ({
  pressed = false,
  size = "md",
  invalid = false,
  busy = false,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <label data-slot='toggle' {...presentationAttrs({ size })} class={cn(buttonBox({ size }), TOGGLE_PAINT, cls)}>
    {/* `sr-only`, not `hidden`: the input has to stay focusable and stay in the form's submission. */}
    <input
      data-slot={slotToken("toggle-input", inherited)}
      type='checkbox'
      class='sr-only'
      {...(pressed ? { checked: true } : {})}
      {...rest}
      {...fieldStateProps(invalid, busy)}
    />
    {children}
  </label>
);
