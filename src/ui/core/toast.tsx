/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { scopeAttrs } from "../contracts/scope-attrs";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

export type ToastVariant = "default" | "success" | "info" | "warning" | "destructive";
export type ToastPosition = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

type ToastContainerProps = JSX.IntrinsicElements["section"] & { position?: ToastPosition };

type ToastProps = JSX.IntrinsicElements["div"] & { variant?: ToastVariant; dismissible?: boolean; duration?: number };

const toastVariantClasses: Record<ToastVariant, string> = {
  default: "border-border bg-background text-foreground",
  success: "border-status-success-border bg-status-success-subtle text-status-success-subtle-foreground",
  info: "border-status-info-border bg-status-info-subtle text-status-info-subtle-foreground",
  warning: "border-status-warning-border bg-status-warning-subtle text-status-warning-subtle-foreground",
  destructive: "border-status-danger-border bg-status-danger-subtle text-status-danger-subtle-foreground",
};

const positionClasses: Record<ToastPosition, string> = {
  "top-left": "top-4 left-4 items-start",
  "top-center": "top-4 left-1/2 -translate-x-1/2 items-center",
  "top-right": "top-4 right-4 items-end",
  "bottom-left": "bottom-4 left-4 items-start",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 items-center",
  "bottom-right": "bottom-4 right-4 items-end",
};

const ToastContainer: FC<ToastContainerProps> = ({ position = "bottom-right", class: cls, children, "data-slot": inherited, ...rest }) => (
  <section
    data-slot={slotToken("toast-container", inherited)}
    data-position={position}
    aria-label='Notifications'
    aria-live='polite'
    aria-atomic='false'
    class={cn("fixed z-50 flex max-h-screen w-full max-w-sm flex-col gap-2 p-4", positionClasses[position], cls)}
    {...rest}>
    {children}
  </section>
);

const ToastRoot: FC<ToastProps> = ({
  variant = "default",
  dismissible = false,
  duration,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  const interactive = dismissible || (duration !== undefined && duration > 0);
  return (
    <div
      data-slot={slotToken("toast", inherited)}
      data-variant={variant}
      role='status'
      aria-atomic='true'
      {...(interactive ? { "data-scope": "toast", "data-state": JSON.stringify({ duration }) } : {})}
      class={cn(
        "relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg",
        toastVariantClasses[variant],
        dismissible && "pr-10",
        cls,
      )}
      {...rest}>
      <div data-slot='toast-body' class='flex-1 space-y-1'>
        {children}
      </div>
      {dismissible ? (
        <button
          type='button'
          data-slot='toast-close'
          aria-label='Dismiss notification'
          {...scopeAttrs<"dismiss">({ onClick: "dismiss" })}
          class='absolute right-2 top-2 rounded p-1 opacity-50 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
          <span aria-hidden='true' class='text-sm leading-none'>
            ×
          </span>
        </button>
      ) : null}
    </div>
  );
};

const ToastTitle: FC<JSX.IntrinsicElements["div"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("toast-title", inherited)} class={cn("text-sm font-semibold leading-none", cls)} {...rest}>
    {children}
  </div>
);

const ToastDescription: FC<JSX.IntrinsicElements["div"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("toast-description", inherited)} class={cn("text-sm opacity-90", cls)} {...rest}>
    {children}
  </div>
);

/** A transient notification, with `Container`, `Title`, and `Description` subcomponents. @public */
export const Toast = Object.assign(ToastRoot, { Container: ToastContainer, Title: ToastTitle, Description: ToastDescription });
