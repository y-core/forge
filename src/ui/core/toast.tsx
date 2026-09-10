/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { ISLAND_STATE_ATTR } from "../contracts/island-contract";
import { scopeAttrs } from "../contracts/scope-attrs";
import { TOAST_DURATION_KEY, TOAST_SCOPE } from "../contracts/toast-contract";
import type { Tone } from "../contracts/types";
import { presentationAttrs } from "../contracts/vocabulary";
import type { PanelAppearance } from "./types";
import type { ToastPosition } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { toneVariants } from "./utils/tone";

type ToastContainerProps = JSX.IntrinsicElements["section"] & {
  position?: ToastPosition | undefined;
  /** Accessible name for the notification region. @default "Notifications" */
  label?: string | undefined;
};

type ToastProps = JSX.IntrinsicElements["div"] & {
  tone?: Tone | undefined;
  appearance?: PanelAppearance | undefined;
  dismissible?: boolean | undefined;
  duration?: number | undefined;
  /** Accessible name for the dismiss button. @default "Dismiss notification" */
  dismissLabel?: string | undefined;
};

const positionClasses: Record<ToastPosition, string> = {
  "top-left": "top-4 left-4 items-start",
  "top-center": "top-4 left-1/2 -translate-x-1/2 items-center",
  "top-right": "top-4 right-4 items-end",
  "bottom-left": "bottom-4 left-4 items-start",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 items-center",
  "bottom-right": "bottom-4 right-4 items-end",
};

// The container is the page's one toast live region, and the individual toasts deliberately are not:
// a live region nested in a live region has undefined announcement behaviour, and of the two only
// this one can announce an *insertion* — `FlashOob` swaps a toast in here after load, and a
// `role="status"` element that did not exist when the region was read is announced by nothing.
// A `Toast` therefore has to be rendered inside a `Toast.Container` to be heard at all.
const ToastContainer: FC<ToastContainerProps> = ({
  position = "bottom-right",
  label = "Notifications",
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <section
    data-slot={slotToken("toast-container", inherited)}
    data-position={position}
    aria-label={label}
    aria-live='polite'
    aria-atomic='false'
    class={cn("fixed z-50 flex max-h-dvh w-full max-w-sm flex-col gap-2 p-4", positionClasses[position], cls)}
    {...rest}>
    {children}
  </section>
);

const ToastRoot: FC<ToastProps> = ({
  tone = "neutral",
  appearance = "soft",
  dismissible = false,
  duration,
  dismissLabel = "Dismiss notification",
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  const interactive = dismissible || (duration !== undefined && duration > 0);
  return (
    <div
      data-slot={slotToken("toast", inherited)}
      {...presentationAttrs({ tone, appearance })}
      {...(interactive ? { "data-scope": TOAST_SCOPE, [ISLAND_STATE_ATTR]: JSON.stringify({ [TOAST_DURATION_KEY]: duration }) } : {})}
      class={cn(
        "relative flex w-full items-start gap-3 rounded-box border-field py-4 ps-4 pe-4 shadow-lg",
        toneVariants({ tone, appearance }),
        dismissible && "pe-10",
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
          aria-label={dismissLabel}
          {...scopeAttrs<"dismiss">({ onClick: "dismiss" })}
          class='absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity'>
          <span aria-hidden='true' class='text-sm leading-none'>
            ×
          </span>
        </button>
      ) : null}
    </div>
  );
};

const ToastTitle: FC<JSX.IntrinsicElements["div"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("toast-title", inherited)} class={cn("text-sm leading-none font-semibold", cls)} {...rest}>
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
