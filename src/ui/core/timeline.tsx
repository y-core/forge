/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { type Orientation, stateAttrs } from "../contracts/state-attrs";
import type { Tone } from "../contracts/vocabulary";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { RULE, STEP_MARKER, STEP_MARKER_STATE, STEP_STATE_LABEL, type StepState } from "./utils/recipes";
import { toneTokens } from "./utils/tone";

interface TimelineRootProps extends Omit<JSX.IntrinsicElements["ol"], "children"> {
  orientation?: Orientation | undefined;
  tone?: Tone | undefined;
  children?: JSXNode | undefined;
}

interface TimelineItemProps extends Omit<JSX.IntrinsicElements["li"], "children"> {
  state?: StepState | undefined;
  /** What the marker circle shows — a number, a glyph, a tick. */
  marker?: JSXNode | undefined;
  children?: JSXNode | undefined;
}

type TimelineTimeProps = Omit<JSX.IntrinsicElements["time"], "children"> & { children?: JSXNode | undefined };
type TimelineContentProps = Omit<JSX.IntrinsicElements["div"], "children"> & { children?: JSXNode | undefined };

// An item reads the axis from the root's `data-orientation` through the named group, so a caller
// sets it once and no item can disagree with its trail.
const ITEM =
  "group/timeline-item flex gap-3 group-data-[orientation=horizontal]/timeline:flex-1 group-data-[orientation=horizontal]/timeline:flex-col";
const MARKER_COLUMN = "flex flex-col items-center group-data-[orientation=horizontal]/timeline:flex-row";
const RULE_LINE = `w-px flex-1 ${RULE} group-last/timeline-item:hidden group-data-[orientation=horizontal]/timeline:h-px group-data-[orientation=horizontal]/timeline:w-auto`;
const BODY =
  "pb-6 group-last/timeline-item:pb-0 group-data-[orientation=horizontal]/timeline:pe-6 group-data-[orientation=horizontal]/timeline:pb-0";

const TimelineRoot: FC<TimelineRootProps> = ({
  orientation = "vertical",
  tone = "primary",
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <ol
    data-slot={slotToken("timeline", inherited)}
    {...stateAttrs({ orientation })}
    class={cn(toneTokens(tone), "group/timeline flex", orientation === "vertical" && "flex-col", cls)}
    {...rest}>
    {children}
  </ol>
);

const TimelineItem: FC<TimelineItemProps> = ({ state = "upcoming", marker, class: cls, children, "data-slot": inherited, ...rest }) => (
  <li data-slot={slotToken("timeline-item", inherited)} data-state={state} class={cn(ITEM, cls)} {...rest}>
    <span data-slot='timeline-marker' aria-hidden='true' class={MARKER_COLUMN}>
      <span class={cn(STEP_MARKER, STEP_MARKER_STATE[state])}>{marker}</span>
      <span data-slot='timeline-rule' class={RULE_LINE}></span>
    </span>
    {/* Outside the `aria-hidden` marker, and not `aria-current`: a record is not a wizard, so
        `current` stays visual — but completion must not be colour alone. */}
    <span class='sr-only'>{STEP_STATE_LABEL[state]}</span>
    <div data-slot='timeline-body' class={BODY}>
      {children}
    </div>
  </li>
);

const TimelineTime: FC<TimelineTimeProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <time data-slot={slotToken("timeline-time", inherited)} class={cn("text-xs text-muted-foreground tabular-nums", cls)} {...rest}>
    {children}
  </time>
);

const TimelineContent: FC<TimelineContentProps> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot={slotToken("timeline-content", inherited)} class={cn("text-sm", cls)} {...rest}>
    {children}
  </div>
);

/** A dated record of events along one axis; `Item` carries a step state, `Time` and `Content` fill its body. @public */
export const Timeline = Object.assign(TimelineRoot, { Item: TimelineItem, Time: TimelineTime, Content: TimelineContent });
