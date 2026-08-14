/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import type { ForgeIcon } from "./icon";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

type SpinnerSize = "sm" | "md" | "lg";

interface SpinnerProps extends Omit<JSX.IntrinsicElements["span"], "children"> {
  icon: ForgeIcon<"spinner">;
  size?: SpinnerSize;
  label?: string;
}

const sizeClasses: Record<SpinnerSize, string> = { sm: "size-4", md: "size-6", lg: "size-8" };

/** A spinning busy indicator with a visually hidden status label. @public */
export const Spinner: FC<SpinnerProps> = ({ icon: Icon, size = "md", label = "Loading…", class: cls, "data-slot": inherited, ...rest }) => (
  <span data-slot={slotToken("spinner", inherited)} role='status' class={cn("inline-flex items-center justify-center", cls)} {...rest}>
    <Icon name='spinner' class={cn("animate-spin", sizeClasses[size])} />
    <span class='sr-only'>{label}</span>
  </span>
);
