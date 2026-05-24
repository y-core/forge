import type { FC } from "hono/jsx";
import { cn } from "./utils/cn";

interface SeparatorProps {
  orientation?: "horizontal" | "vertical";
  class?: string;
}

export const Separator: FC<SeparatorProps> = ({ orientation = "horizontal", class: cls }) => (
  <hr
    data-slot="separator"
    aria-orientation={orientation}
    class={cn(
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      "border-0 bg-brand-200",
      cls,
    )}
  />
);
