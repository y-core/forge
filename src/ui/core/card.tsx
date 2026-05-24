import type { FC, PropsWithChildren } from "hono/jsx";
import { cn } from "./utils/cn";

interface CardProps {
  class?: string;
}

export const Card: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div
    data-slot="card"
    class={cn("flex flex-col rounded-2xl border border-brand-200 bg-brand-100 text-brand-900 shadow-sm", cls)}
  >
    {children}
  </div>
);

export const CardHeader: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div
    data-slot="card-header"
    class={cn("grid auto-rows-min grid-cols-[1fr_auto] items-start gap-1.5 border-b border-brand-200 px-6 py-5", cls)}
  >
    {children}
  </div>
);

export const CardTitle: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div data-slot="card-title" class={cn("font-semibold leading-none text-brand-900", cls)}>
    {children}
  </div>
);

export const CardDescription: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div data-slot="card-description" class={cn("text-sm text-brand-600", cls)}>
    {children}
  </div>
);

export const CardAction: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div
    data-slot="card-action"
    class={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", cls)}
  >
    {children}
  </div>
);

export const CardContent: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div data-slot="card-content" class={cn("px-6 py-5", cls)}>
    {children}
  </div>
);

export const CardFooter: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div
    data-slot="card-footer"
    class={cn("flex items-center gap-2 border-t border-brand-200 px-6 py-4", cls)}
  >
    {children}
  </div>
);
