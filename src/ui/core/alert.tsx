/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, PropsWithChildren } from "../../jsx/types";
import { cn } from "./utils/cn";

const variantClasses = {
  default: "border-border bg-muted text-foreground",
  destructive: "border-red-200 bg-red-50 text-red-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-yellow-200 bg-yellow-50 text-yellow-900",
};

export type AlertVariant = keyof typeof variantClasses;

interface AlertProps {
  variant?: AlertVariant;
  dismissible?: boolean;
  class?: string;
}

const AlertRoot: FC<PropsWithChildren<AlertProps>> = ({ variant = "default", dismissible = false, class: cls, children }) => (
  <div
    data-slot='alert'
    data-variant={variant}
    class={cn("relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm", variantClasses[variant], dismissible && "pr-8", cls)}>
    {children}
    {dismissible ? (
      <button
        type='button'
        data-slot='alert-dismiss'
        aria-label='Dismiss'
        class='absolute right-2 top-2 rounded opacity-50 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring'>
        <span aria-hidden='true' class='text-base leading-none'>
          ×
        </span>
      </button>
    ) : null}
  </div>
);

const AlertTitle: FC<PropsWithChildren<{ class?: string }>> = ({ class: cls, children }) => (
  <div data-slot='alert-title' class={cn("font-medium leading-none tracking-tight", cls)}>
    {children}
  </div>
);

const AlertDescription: FC<PropsWithChildren<{ class?: string }>> = ({ class: cls, children }) => (
  <div data-slot='alert-description' class={cn("text-sm leading-relaxed opacity-90", cls)}>
    {children}
  </div>
);

export const Alert = Object.assign(AlertRoot, { Title: AlertTitle, Description: AlertDescription });
