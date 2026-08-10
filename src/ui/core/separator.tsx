/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface SeparatorProps extends Omit<JSX.IntrinsicElements["hr"], "children"> {
  orientation?: "horizontal" | "vertical";
}

/**
 * A horizontal or vertical rule.
 *
 * The vertical form takes its height from the flex line rather than a percentage: `h-full` needs an
 * ancestor with a definite height, and an auto-height `flex items-center` row — the commonest host
 * for a vertical divider — has none, so the rule resolves to zero and the element renders invisible.
 */
export const Separator: FC<SeparatorProps> = ({ orientation = "horizontal", class: cls, "data-slot": inherited, ...rest }) => (
  <hr
    data-slot={slotToken("separator", inherited)}
    aria-orientation={orientation}
    class={cn(orientation === "horizontal" ? "h-px w-full" : "self-stretch w-px", "border-0 bg-border", cls)}
    {...rest}
  />
);
