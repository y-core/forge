/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

type StatProps = JSX.IntrinsicElements["div"];
type StatTextProps = JSX.IntrinsicElements["span"];

const StatRoot: FC<StatProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    data-slot={slotToken("stat", inherited)}
    class={cn("flex flex-col gap-1 rounded-box border-field border-border bg-card p-4 text-card-foreground", cls)}
    {...rest}>
    {children}
  </div>
);

const StatLabel: FC<StatTextProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <span data-slot={slotToken("stat-label", inherited)} class={cn("text-sm text-muted-foreground", cls)} {...rest}>
    {children}
  </span>
);

const StatValue: FC<StatTextProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <span data-slot={slotToken("stat-value", inherited)} class={cn("text-2xl font-semibold tracking-tight text-balance tabular-nums", cls)} {...rest}>
    {children}
  </span>
);

const StatDescription: FC<StatTextProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <span data-slot={slotToken("stat-description", inherited)} class={cn("text-xs text-muted-foreground", cls)} {...rest}>
    {children}
  </span>
);

const StatFigure: FC<StatTextProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <span data-slot={slotToken("stat-figure", inherited)} class={cn("text-muted-foreground", cls)} {...rest}>
    {children}
  </span>
);

const StatActions: FC<StatProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("stat-actions", inherited)} class={cn("mt-2 flex gap-2", cls)} {...rest}>
    {children}
  </div>
);

/** A single measurement on a bordered surface, with `Label`, `Value`, `Description`, `Figure`, and `Actions` subcomponents. @public */
export const Stat = Object.assign(StatRoot, {
  Label: StatLabel,
  Value: StatValue,
  Description: StatDescription,
  Figure: StatFigure,
  Actions: StatActions,
});
