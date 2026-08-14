/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { scopeAttrs } from "../contracts/scope-attrs";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

const variantClasses = {
  default: "border-border bg-muted text-foreground",
  destructive: "border-status-danger-border bg-status-danger-subtle text-status-danger-subtle-foreground",
  info: "border-status-info-border bg-status-info-subtle text-status-info-subtle-foreground",
  success: "border-status-success-border bg-status-success-subtle text-status-success-subtle-foreground",
  warning: "border-status-warning-border bg-status-warning-subtle text-status-warning-subtle-foreground",
};

export type AlertVariant = keyof typeof variantClasses;

type AlertProps = JSX.IntrinsicElements["div"] & { variant?: AlertVariant; dismissible?: boolean };

const AlertRoot: FC<AlertProps> = ({ variant = "default", dismissible = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    data-slot={slotToken("alert", inherited)}
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
        class='absolute right-2 top-2 rounded opacity-50 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
        <span aria-hidden='true' class='text-base leading-none'>
          ×
        </span>
      </button>
    ) : null}
  </div>
);

const AlertTitle: FC<JSX.IntrinsicElements["div"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("alert-title", inherited)} class={cn("font-medium leading-none tracking-tight", cls)} {...rest}>
    {children}
  </div>
);

const AlertDescription: FC<JSX.IntrinsicElements["div"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("alert-description", inherited)} class={cn("text-sm leading-relaxed opacity-90", cls)} {...rest}>
    {children}
  </div>
);

/** A callout for a status message, with `Title` and `Description` subcomponents and an optional dismiss button. @public */
export const Alert = Object.assign(AlertRoot, { Title: AlertTitle, Description: AlertDescription });
