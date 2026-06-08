/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge */
import type { FC, PropsWithChildren } from "../../jsx/types";
import { cn } from "./utils/cn";

interface CardProps {
  class?: string;
}

const CardRoot: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div data-slot='card' class={cn("flex flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-sm", cls)}>
    {children}
  </div>
);

const CardHeader: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div data-slot='card-header' class={cn("grid auto-rows-min grid-cols-[1fr_auto] items-start gap-1.5 border-b border-border px-6 py-5", cls)}>
    {children}
  </div>
);

const CardTitle: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div data-slot='card-title' class={cn("font-semibold leading-none text-card-foreground", cls)}>
    {children}
  </div>
);

const CardDescription: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div data-slot='card-description' class={cn("text-sm text-muted-foreground", cls)}>
    {children}
  </div>
);

const CardAction: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div data-slot='card-action' class={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", cls)}>
    {children}
  </div>
);

const CardContent: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div data-slot='card-content' class={cn("px-6 py-5", cls)}>
    {children}
  </div>
);

const CardFooter: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div data-slot='card-footer' class={cn("flex items-center gap-2 border-t border-border px-6 py-4", cls)}>
    {children}
  </div>
);

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Action: CardAction,
  Content: CardContent,
  Footer: CardFooter,
});
