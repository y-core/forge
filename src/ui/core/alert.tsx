/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { scopeAttrs } from "../server/scope-attrs";
import { cn } from "./utils/cn";

const variantClasses = {
  default: "border-border bg-muted text-foreground",
  destructive: "border-red-200 bg-red-50 text-red-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-yellow-200 bg-yellow-50 text-yellow-900",
};

export type AlertVariant = keyof typeof variantClasses;

type AlertProps = JSX.IntrinsicElements["div"] & { variant?: AlertVariant; dismissible?: boolean };

const AlertRoot: FC<AlertProps> = ({ variant = "default", dismissible = false, class: cls, children, ...rest }) => (
  <div
    data-slot='alert'
    data-variant={variant}
    {...(dismissible ? { "data-scope": "alert" } : {})}
    class={cn("relative grid gap-1.5 rounded-2xl border px-4 py-3 text-sm", variantClasses[variant], dismissible && "pr-8", cls)}
    {...rest}>
    {children}
    {dismissible ? (
      <button
        type='button'
        data-slot='alert-dismiss'
        aria-label='Dismiss'
        {...scopeAttrs<"dismiss">({ onClick: "dismiss" })}
        class='absolute right-2 top-2 rounded opacity-50 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring'>
        <span aria-hidden='true' class='text-base leading-none'>
          ×
        </span>
      </button>
    ) : null}
  </div>
);

const AlertTitle: FC<JSX.IntrinsicElements["div"]> = ({ class: cls, children, ...rest }) => (
  <div data-slot='alert-title' class={cn("font-medium leading-none tracking-tight", cls)} {...rest}>
    {children}
  </div>
);

const AlertDescription: FC<JSX.IntrinsicElements["div"]> = ({ class: cls, children, ...rest }) => (
  <div data-slot='alert-description' class={cn("text-sm leading-relaxed opacity-90", cls)} {...rest}>
    {children}
  </div>
);

export const Alert = Object.assign(AlertRoot, { Title: AlertTitle, Description: AlertDescription });
