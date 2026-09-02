/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

const variantClasses = {
  default: cn("border-transparent bg-primary text-primary-foreground"),
  secondary: cn("border-transparent bg-secondary text-secondary-foreground"),
  destructive: cn("border-status-danger-border bg-status-danger-strong text-status-danger-strong-foreground"),
  info: cn("border-status-info-border bg-status-info-strong text-status-info-strong-foreground"),
  success: cn("border-status-success-border bg-status-success-strong text-status-success-strong-foreground"),
  warning: cn("border-status-warning-border bg-status-warning-strong text-status-warning-strong-foreground"),
  outline: cn("border-border text-foreground"),
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
