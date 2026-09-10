/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import type { Orientation } from "../contracts/types";
import type { Tone } from "../contracts/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { STEP_MARKER, STEP_MARKER_STATE, STEP_STATE_LABEL } from "./utils/recipes";
import { toneTokens } from "./utils/tone";
import type { StepState } from "./utils/types";

interface StepsRootProps extends Omit<JSX.IntrinsicElements["ol"], "children"> {
  orientation?: Orientation | undefined;
  tone?: Tone | undefined;
  children?: JSXNode | undefined;
}

interface StepProps extends Omit<JSX.IntrinsicElements["li"], "children"> {
  state?: StepState | undefined;
  /** What the marker circle shows — a number, a glyph, a tick. */
  marker?: JSXNode | undefined;
  children?: JSXNode | undefined;
}

const StepsRoot: FC<StepsRootProps> = ({ orientation = "horizontal", tone = "primary", class: cls, children, "data-slot": inherited, ...rest }) => (
  <ol
    data-slot={slotToken("steps", inherited)}
    {...stateAttrs({ orientation })}
    class={cn(toneTokens(tone), orientation === "vertical" ? "flex flex-col gap-4" : "flex gap-4", cls)}
    {...rest}>
    {children}
  </ol>
);

const Step: FC<StepProps> = ({ state = "upcoming", marker, class: cls, children, "data-slot": inherited, ...rest }) => (
  <li
    data-slot={slotToken("steps-step", inherited)}
    data-state={state}
    {...(state === "current" ? { "aria-current": "step" } : {})}
    class={cn("flex items-center gap-2", cls)}
    {...rest}>
    <span data-slot='steps-marker' aria-hidden='true' class={cn(STEP_MARKER, STEP_MARKER_STATE[state])}>
      {marker}
    </span>
    {/* The three states differ only in colour, and the marker is `aria-hidden`. `aria-current` marks
        where the reader *is*; nothing else marked what is finished. */}
    <span class='sr-only'>{STEP_STATE_LABEL[state]}</span>
    <span data-slot='steps-label'>{children}</span>
  </li>
);

/** An ordered progress trail whose `Step` subcomponent carries its own completion state. @public */
export const Steps = Object.assign(StepsRoot, { Step });
