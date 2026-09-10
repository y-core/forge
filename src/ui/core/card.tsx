/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { PANEL_FOOTER, PANEL_HEADER } from "./utils/recipes";

type CardProps = JSX.IntrinsicElements["div"];

const CardRoot: FC<CardProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    data-slot={slotToken("card", inherited)}
    class={cn("flex flex-col rounded-box border border-border bg-card text-card-foreground shadow-sm", cls)}
    {...rest}>
    {children}
  </div>
);

const CardHeader: FC<CardProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("card-header", inherited)} class={cn(PANEL_HEADER, cls)} {...rest}>
    {children}
  </div>
);

const CardTitle: FC<CardProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("card-title", inherited)} class={cn("col-start-1 leading-none font-semibold text-card-foreground", cls)} {...rest}>
    {children}
  </div>
);

// `col-start-1` and nothing else keeps the description under the title: the header's second track
// belongs to `Card.Action`, and an auto-placed description lands in it whenever no action is there.
const CardDescription: FC<CardProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("card-description", inherited)} class={cn("col-start-1 text-sm text-muted-foreground", cls)} {...rest}>
    {children}
  </div>
);

const CardAction: FC<CardProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("card-action", inherited)} class={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", cls)} {...rest}>
    {children}
  </div>
);

const CardContent: FC<CardProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("card-content", inherited)} class={cn("px-6 py-5", cls)} {...rest}>
    {children}
  </div>
);

const CardFooter: FC<CardProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("card-footer", inherited)} class={cn(PANEL_FOOTER, cls)} {...rest}>
    {children}
  </div>
);

/** A bordered surface container, with `Header`, `Title`, `Description`, `Action`, `Content`, and `Footer` subcomponents. @public */
export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Action: CardAction,
  Content: CardContent,
  Footer: CardFooter,
});
