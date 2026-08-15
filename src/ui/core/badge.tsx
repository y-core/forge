/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

const variantClasses = {
  default: "bg-primary text-primary-foreground border-transparent",
  secondary: "bg-secondary text-secondary-foreground border-transparent",
  destructive: "bg-status-danger-strong text-status-danger-strong-foreground border-status-danger-border",
  info: "bg-status-info-strong text-status-info-strong-foreground border-status-info-border",
  success: "bg-status-success-strong text-status-success-strong-foreground border-status-success-border",
  warning: "bg-status-warning-strong text-status-warning-strong-foreground border-status-warning-border",
  outline: "border-border text-foreground",
};

export type BadgeVariant = keyof typeof variantClasses;

type BadgeProps = JSX.IntrinsicElements["span"] & { variant?: BadgeVariant };

/** A small pill-shaped label for a status, count, or category. @public */
export const Badge: FC<BadgeProps> = ({ variant = "default", class: cls, children, "data-slot": inherited, ...rest }) => (
  <span
    data-slot={slotToken("badge", inherited)}
    data-variant={variant}
    class={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", variantClasses[variant], cls)}
    {...rest}>
    {children}
  </span>
);
