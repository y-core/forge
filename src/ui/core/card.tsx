import type { FC, PropsWithChildren } from "hono/jsx";
import { cn } from "./utils/cn";

interface CardProps {
  class?: string;
}

const CardRoot: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div class={cn("rounded-2xl border border-brand-200 bg-brand-100 shadow-sm", cls)}>
    {children}
  </div>
);

const CardHeader: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div class={cn("px-6 py-5 border-b border-brand-200", cls)}>{children}</div>
);

const CardContent: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div class={cn("px-6 py-5", cls)}>{children}</div>
);

const CardFooter: FC<PropsWithChildren<CardProps>> = ({ class: cls, children }) => (
  <div class={cn("px-6 py-4 border-t border-brand-200", cls)}>{children}</div>
);

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Content: CardContent,
  Footer: CardFooter,
});
