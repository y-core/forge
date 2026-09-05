/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { RULE } from "./utils/recipes";

interface SeparatorProps extends Omit<JSX.IntrinsicElements["hr"], "children"> {
  orientation?: "horizontal" | "vertical" | undefined;
}

// `h-auto` is what makes `self-stretch` reach an `<hr>` at all: preflight sets `height: 0` on it, and
// no alignment can grow a box whose height is already definite.
const VERTICAL = "h-auto w-px self-stretch";

/** A horizontal or vertical rule. */
export const Separator: FC<SeparatorProps> = ({ orientation = "horizontal", class: cls, "data-slot": inherited, ...rest }) => (
  <hr
    data-slot={slotToken("separator", inherited)}
    aria-orientation={orientation}
    class={cn(orientation === "horizontal" ? "h-px w-full" : VERTICAL, RULE, cls)}
    {...rest}
  />
);
