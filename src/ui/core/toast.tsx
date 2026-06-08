/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge */
import type { FC, PropsWithChildren } from "../../jsx/types";
import { cn } from "./utils/cn";

export type ToastVariant = "default" | "success" | "info" | "warning" | "destructive";
export type ToastPosition = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

interface ToastContainerProps {
  id?: string;
  position?: ToastPosition;
  class?: string;
}

interface ToastProps {
  variant?: ToastVariant;
  dismissible?: boolean;
  class?: string;
}

interface ToastTitleProps {
  class?: string;
}

interface ToastDescriptionProps {
  class?: string;
}

const toastVariantClasses: Record<ToastVariant, string> = {
  default: "border-border bg-background text-foreground",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
  warning: "border-yellow-200 bg-yellow-50 text-yellow-900",
  destructive: "border-red-200 bg-red-50 text-red-900",
};

const positionClasses: Record<ToastPosition, string> = {
  "top-left": "top-4 left-4 items-start",
  "top-center": "top-4 left-1/2 -translate-x-1/2 items-center",
  "top-right": "top-4 right-4 items-end",
  "bottom-left": "bottom-4 left-4 items-start",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 items-center",
  "bottom-right": "bottom-4 right-4 items-end",
};

const ToastContainer: FC<PropsWithChildren<ToastContainerProps>> = ({ id, position = "bottom-right", class: cls, children }) => (
  <section
    data-slot='toast-container'
    data-position={position}
    {...(id !== undefined ? { id } : {})}
    aria-label='Notifications'
    aria-live='polite'
    aria-atomic='false'
    class={cn("fixed z-50 flex max-h-screen w-full max-w-sm flex-col gap-2 p-4", positionClasses[position], cls)}>
    {children}
  </section>
);

const ToastRoot: FC<PropsWithChildren<ToastProps>> = ({ variant = "default", dismissible = false, class: cls, children }) => (
  <div
    data-slot='toast'
    data-variant={variant}
    role='status'
    aria-atomic='true'
    class={cn("relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg", toastVariantClasses[variant], dismissible && "pr-10", cls)}>
    <div data-slot='toast-body' class='flex-1 space-y-1'>
      {children}
    </div>
    {dismissible ? (
      <button
        type='button'
        data-slot='toast-close'
        aria-label='Dismiss notification'
        class='absolute right-2 top-2 rounded p-1 opacity-50 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring'>
        <span aria-hidden='true' class='text-sm leading-none'>
          ×
        </span>
      </button>
    ) : null}
  </div>
);

const ToastTitle: FC<PropsWithChildren<ToastTitleProps>> = ({ class: cls, children }) => (
  <div data-slot='toast-title' class={cn("text-sm font-semibold leading-none", cls)}>
    {children}
  </div>
);

const ToastDescription: FC<PropsWithChildren<ToastDescriptionProps>> = ({ class: cls, children }) => (
  <div data-slot='toast-description' class={cn("text-sm opacity-90", cls)}>
    {children}
  </div>
);

export const Toast = Object.assign(ToastRoot, { Container: ToastContainer, Title: ToastTitle, Description: ToastDescription });
