import type { FC, PropsWithChildren } from "hono/jsx";
import { cn } from "./utils/cn";

const variantClasses = {
  default: "border-brand-200 bg-brand-100 text-brand-900",
  destructive: "border-red-200 bg-red-50 text-red-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

export type AlertVariant = keyof typeof variantClasses;

interface AlertProps {
  variant?: AlertVariant;
  class?: string;
}

export const Alert: FC<PropsWithChildren<AlertProps>> = ({
  variant = "default",
  class: cls,
  children,
}) => (
  <div class={cn("rounded-2xl border px-4 py-3 text-sm", variantClasses[variant], cls)}>
    {children}
  </div>
);
