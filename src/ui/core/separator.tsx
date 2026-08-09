/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

interface SeparatorProps extends Omit<JSX.IntrinsicElements["hr"], "children"> {
  orientation?: "horizontal" | "vertical";
}

export const Separator: FC<SeparatorProps> = ({ orientation = "horizontal", class: cls, "data-slot": inherited, ...rest }) => (
  <hr
    data-slot={slotToken("separator", inherited)}
    aria-orientation={orientation}
    class={cn(orientation === "horizontal" ? "h-px w-full" : "h-full w-px", "border-0 bg-border", cls)}
    {...rest}
  />
);
