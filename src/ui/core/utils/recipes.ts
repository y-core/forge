/** The pressed paint every `:has(:checked)` control shares; passed as its own `cn` argument, never a token of another literal. @internal */
export const PRESSED_PAINT = "has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary";

/** The header band of a Card or Dialog: title column, action column, and the rule beneath. @internal */
export const PANEL_HEADER = "grid auto-rows-min grid-cols-[1fr_auto] items-start gap-1.5 border-b border-border px-6 py-5";

/** The footer band of a Card or Dialog: a row of actions above the rule. @internal */
export const PANEL_FOOTER = "flex items-center gap-2 border-t border-border px-6 py-4";

/** A separator drawn as a filled box rather than a border, so its thickness is its size. @internal */
export const RULE = "border-0 bg-border";

/** Height and type size per control `Size`, read from the `--control-h-*` tokens. @internal */
export const FIELD_SIZE = { sm: "h-control-sm text-sm", md: "h-control-md text-sm", lg: "h-control-lg text-base" } as const;

/** Where a step or timeline entry stands: done, the one in hand, or still ahead. @internal */
export type StepState = "complete" | "current" | "upcoming";

/** The marker circle a Steps step or a Timeline item paints its state into. @internal */
export const STEP_MARKER = "inline-flex size-control-sm items-center justify-center rounded-selector border-field text-sm font-medium";

/** The word a screen reader gets for each `StepState`, since the marker differs only in colour. @internal */
export const STEP_STATE_LABEL: Record<StepState, string> = { complete: "Completed", current: "Current", upcoming: "Not started" };

/** The marker's paint per `StepState`, read from the `--tone` properties the root hands down. @internal */
export const STEP_MARKER_STATE: Record<StepState, string> = {
  complete: "border-transparent bg-(--tone) text-(--tone-fg)",
  current: "border-(--tone-text) text-(--tone-text)",
  upcoming: "border-border text-muted-foreground",
};
