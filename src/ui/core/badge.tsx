/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

/**
 * The `-strong` tier rather than `alert.tsx`'s `-subtle`: a badge is a small filled chip, so it
 * starts one stop in from the panel surface — step 3, "UI element background", where a panel takes
 * step 2, "Subtle background". That distinction used to be four hand-written stop choices here and
 * four more there, kept in agreement by a comment; it is now two named roles in one place —
 * `theme-base.css`'s status block — which is what stops them drifting.
 *
 * The four status variants take the same four intents `alert.tsx` uses, for the argument stated in
 * full in the block comment on `variantClasses` there: a status hue has to stay red / blue /
 * emerald / yellow whatever the application has pointed `--destructive` at. Not restated here.
 *
 * `warning` is **yellow, not amber**, so that the four hues are the same four everywhere in forge —
 * the log viewer's old amber map was an outlier and is what made a fourth palette possible.
 *
 * **The measured ratios are not here.** The four `--status-*-strong-foreground` rows in
 * `TOKEN_CONTRACT` (`scripts/contrast-parse.ts`) hold them, each against the `-strong` surface it is
 * read on, and each clears the 4.5:1 floor of WCAG 1.4.3 for the `text-xs` these chips render at.
 * They are re-checked on every gate run, which a table in a comment never was.
 */
const variantClasses = {
  default: "bg-primary text-primary-foreground border-transparent",
  secondary: "bg-secondary text-secondary-foreground border-transparent",
  destructive: "bg-status-danger-strong text-status-danger-strong-foreground border-status-danger-border",
  info: "bg-status-info-strong text-status-info-strong-foreground border-status-info-border",
  success: "bg-status-success-strong text-status-success-strong-foreground border-status-success-border",
  warning: "bg-status-warning-strong text-status-warning-strong-foreground border-status-warning-border",
  outline: "border-border text-foreground",
};

export type BadgeVariant = keyof typeof variantClasses;

type BadgeProps = JSX.IntrinsicElements["span"] & { variant?: BadgeVariant };

export const Badge: FC<BadgeProps> = ({ variant = "default", class: cls, children, "data-slot": inherited, ...rest }) => (
  <span
    data-slot={slotToken("badge", inherited)}
    data-variant={variant}
    class={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors", variantClasses[variant], cls)}
    {...rest}>
    {children}
  </span>
);
