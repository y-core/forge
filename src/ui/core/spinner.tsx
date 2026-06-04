import type { FC } from "hono/jsx";
import type { ForgeIcon } from "./icon";
import { cn } from "./utils/cn";

type SpinnerSize = "sm" | "md" | "lg";

interface SpinnerProps {
  icon: ForgeIcon<"spinner">;
  size?: SpinnerSize;
  label?: string;
  class?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: "size-4",
  md: "size-6",
  lg: "size-8",
};

export const Spinner: FC<SpinnerProps> = ({
  icon: Icon,
  size = "md",
  label = "Loading…",
  class: cls,
}) => (
  <span
    data-slot="spinner"
    role="status"
    class={cn("inline-flex items-center justify-center", cls)}
  >
    <Icon name="spinner" class={cn("animate-spin", sizeClasses[size])} />
    <span class="sr-only">{label}</span>
  </span>
);
