import type { StepState } from "./types";
/** The pressed paint every `:has(:checked)` control shares; passed as its own `cn` argument, never a token of another literal. @internal */
export const PRESSED_PAINT = "has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:checked]:hover:bg-primary";

/** The header band of a Card or Dialog: title column, action column, and the rule beneath. @internal */
export const PANEL_HEADER = "grid auto-rows-min grid-cols-[1fr_auto] items-start gap-1.5 border-b border-border px-6 py-5";

/** The footer band of a Card or Dialog: a row of actions above the rule. @internal */
export const PANEL_FOOTER = "flex items-center gap-2 border-t border-border px-6 py-4";

/** A separator drawn as a filled box rather than a border, so its thickness is its size. @internal */
export const RULE = "border-0 bg-border";

const FIELD_HEIGHT = { sm: "h-control-sm", md: "h-control-md", lg: "h-control-lg" } as const;

/** Type size per control `Size`, for a control that takes its own height rather than the token's. @internal */
export const FIELD_TEXT_SIZE = { sm: "text-sm", md: "text-sm", lg: "text-base" } as const;

/** Height and type size per control `Size`, read from the `--control-h-*` tokens. @internal */
export const FIELD_SIZE = {
  sm: `${FIELD_HEIGHT.sm} ${FIELD_TEXT_SIZE.sm}`,
  md: `${FIELD_HEIGHT.md} ${FIELD_TEXT_SIZE.md}`,
  lg: `${FIELD_HEIGHT.lg} ${FIELD_TEXT_SIZE.lg}`,
} as const;

/** The marker circle a Steps step or a Timeline item paints its state into. @internal */
export const STEP_MARKER = "inline-flex size-control-sm items-center justify-center rounded-selector border-field text-sm font-medium";

/** The word a screen reader gets for each `StepState`, since the marker differs only in colour. @internal */
/** The marker's paint per `StepState`, read from the `--tone` properties the root hands down. @internal */
export const STEP_MARKER_STATE: Record<StepState, string> = {
  complete: "border-transparent bg-(--tone) text-(--tone-fg)",
  current: "border-(--tone-text) text-(--tone-text)",
  upcoming: "border-border text-muted-foreground",
};
