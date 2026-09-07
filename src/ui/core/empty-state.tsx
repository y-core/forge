/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

type EmptyStateProps = JSX.IntrinsicElements["div"];
type EmptyStateFigureProps = JSX.IntrinsicElements["span"];
type EmptyStateTitleProps = JSX.IntrinsicElements["h3"] & {
  /** Heading level, from the section's position in the document. Never from its size — the class is
   *  fixed, so a level change is a semantic one. Defaults to `3`. */
  level?: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
};
type EmptyStateDescriptionProps = JSX.IntrinsicElements["p"];

const EmptyStateRoot: FC<EmptyStateProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div
    data-slot={slotToken("empty-state", inherited)}
    class={cn("flex flex-col items-center gap-3 rounded-box border-field border-dashed border-border p-8 text-center", cls)}
    {...rest}>
    {children}
  </div>
);

const EmptyStateFigure: FC<EmptyStateFigureProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <span data-slot={slotToken("empty-state-figure", inherited)} class={cn("text-muted-foreground", cls)} {...rest}>
    {children}
  </span>
);

const EmptyStateTitle: FC<EmptyStateTitleProps> = ({ class: cls, children, level, "data-slot": inherited, ...rest }) => {
  const Heading = `h${level ?? 3}` as "h3";
  return (
    <Heading data-slot={slotToken("empty-state-title", inherited)} class={cn("text-base font-semibold", cls)} {...rest}>
      {children}
    </Heading>
  );
};

const EmptyStateDescription: FC<EmptyStateDescriptionProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <p data-slot={slotToken("empty-state-description", inherited)} class={cn("max-w-prose text-sm text-pretty text-muted-foreground", cls)} {...rest}>
    {children}
  </p>
);

const EmptyStateActions: FC<EmptyStateProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("empty-state-actions", inherited)} class={cn("mt-2 flex flex-wrap justify-center gap-2", cls)} {...rest}>
    {children}
  </div>
);

/** The placeholder an empty list or table renders, with `Figure`, `Title`, `Description`, and `Actions` subcomponents. @public */
export const EmptyState = Object.assign(EmptyStateRoot, {
  Figure: EmptyStateFigure,
  Title: EmptyStateTitle,
  Description: EmptyStateDescription,
  Actions: EmptyStateActions,
});
