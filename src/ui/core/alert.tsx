/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { scopeAttrs } from "../contracts/scope-attrs";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

/**
 * Every variant goes through semantic tokens and re-maps under `.dark` for free — the status four by
 * way of the `--status-*` family, which exists because of the constraint they used to state in
 * hand-written `dark:` pairs.
 *
 * That constraint has not gone away, it has moved into the token names. A status hue must stay
 * red / blue / emerald / yellow whatever the application has pointed `--destructive` at, so the
 * obvious-looking `bg-destructive text-destructive-foreground` is still wrong: `--destructive` is the
 * *app's* destructive colour and an app may legitimately re-point it to its brand — a warning that is
 * orange rather than yellow is an ordinary thing to want — and a failure panel that follows it stops
 * meaning "failed". `--status-danger-*` is forge's, and no scheme or brand swap moves it.
 *
 * `-subtle` is the panel tier: `Alert`, `Toast` and the two banner strings in `src/http/fragment.ts`
 * all render it. `Badge` takes `-strong` instead, one stop in, because a filled chip starts from a
 * tinted surface rather than from a panel's.
 *
 * **The measured ratios are not here.** They are `TOKEN_CONTRACT` rows in `scripts/contrast-parse.ts`,
 * beside the values they describe and re-checked on every gate run. This comment used to carry them,
 * and carrying them is what let them go wrong: the four numbers it recorded as the light tier were
 * in fact the dark one, and the light tier had never been measured at all. A measurement kept next
 * to prose is a measurement nothing re-reads.
 */
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

export const Alert = Object.assign(AlertRoot, { Title: AlertTitle, Description: AlertDescription });
