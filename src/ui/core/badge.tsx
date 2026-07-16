/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { cn } from "./utils/cn";

const variantClasses = {
  default: "bg-primary text-primary-foreground border-transparent",
  secondary: "bg-secondary text-secondary-foreground border-transparent",
  destructive: "bg-red-100 text-red-800 border-red-200",
  outline: "border-border text-foreground",
};

export type BadgeVariant = keyof typeof variantClasses;

type BadgeProps = JSX.IntrinsicElements["span"] & { variant?: BadgeVariant };

export const Badge: FC<BadgeProps> = ({ variant = "default", class: cls, children, ...rest }) => (
  <span
    data-slot='badge'
    data-variant={variant}
    class={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors", variantClasses[variant], cls)}
    {...rest}>
    {children}
  </span>
);
