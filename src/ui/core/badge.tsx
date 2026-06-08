/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, PropsWithChildren } from "../../jsx/types";
import { cn } from "./utils/cn";

const variantClasses = {
  default: "bg-primary text-primary-foreground border-transparent",
  secondary: "bg-secondary text-secondary-foreground border-transparent",
  destructive: "bg-red-100 text-red-800 border-red-200",
  outline: "border-border text-foreground",
};

export type BadgeVariant = keyof typeof variantClasses;

interface BadgeProps {
  variant?: BadgeVariant;
  class?: string;
}

export const Badge: FC<PropsWithChildren<BadgeProps>> = ({ variant = "default", class: cls, children }) => (
  <span
    data-slot='badge'
    data-variant={variant}
    class={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors", variantClasses[variant], cls)}>
    {children}
  </span>
);
