/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { ALERT_SCOPE } from "../contracts/alert-contract";
import { scopeAttrs } from "../contracts/scope-attrs";
import { presentationAttrs } from "../contracts/vocabulary";
import type { Appearance, Tone } from "../contracts/vocabulary";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { toneVariants } from "./utils/tone";

/** The appearances a callout takes — a panel is filled or tinted, never outlined or bare. @public */
export type PanelAppearance = Extract<Appearance, "solid" | "soft">;

type AlertProps = JSX.IntrinsicElements["div"] & {
  tone?: Tone | undefined;
  appearance?: PanelAppearance | undefined;
  dismissible?: boolean | undefined;
  /** Accessible name for the dismiss button. @default "Dismiss" */
  dismissLabel?: string | undefined;
};

const AlertRoot: FC<AlertProps> = ({
  tone = "neutral",
  appearance = "soft",
  dismissible = false,
  dismissLabel = "Dismiss",
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <div
    data-slot={slotToken("alert", inherited)}
    {...presentationAttrs({ tone, appearance })}
    {...(dismissible ? { "data-scope": ALERT_SCOPE } : {})}
    class={cn(
      "relative grid gap-1.5 rounded-box border-field py-3 ps-4 pe-4 text-sm",
      toneVariants({ tone, appearance }),
      dismissible && "pe-8",
      cls,
    )}
    {...rest}>
    {children}
    {dismissible ? (
      <button
        type='button'
        data-slot='alert-dismiss'
        aria-label={dismissLabel}
        {...scopeAttrs<"dismiss">({ onClick: "dismiss" })}
        class='absolute end-2 top-2 rounded opacity-50 focus-ring hover:opacity-100 motion-safe:transition-opacity'>
        <span aria-hidden='true' class='text-base leading-none'>
          ×
        </span>
      </button>
    ) : null}
  </div>
);

const AlertTitle: FC<JSX.IntrinsicElements["div"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("alert-title", inherited)} class={cn("leading-none font-medium tracking-tight", cls)} {...rest}>
    {children}
  </div>
);

const AlertDescription: FC<JSX.IntrinsicElements["div"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("alert-description", inherited)} class={cn("text-sm leading-relaxed text-pretty opacity-90", cls)} {...rest}>
    {children}
  </div>
);

/** A callout for a status message, with `Title` and `Description` subcomponents and an optional dismiss button. @public */
export const Alert = Object.assign(AlertRoot, { Title: AlertTitle, Description: AlertDescription });
