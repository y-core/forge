/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC } from "../../jsx/types";
import { cn } from "./utils/cn";

interface SeparatorProps {
  orientation?: "horizontal" | "vertical";
  class?: string;
}

export const Separator: FC<SeparatorProps> = ({ orientation = "horizontal", class: cls }) => (
  <hr
    data-slot='separator'
    aria-orientation={orientation}
    class={cn(orientation === "horizontal" ? "h-px w-full" : "h-full w-px", "border-0 bg-border", cls)}
  />
);
