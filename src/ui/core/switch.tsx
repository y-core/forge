/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import type { Size } from "../contracts/types";
import { presentationAttrs } from "../contracts/vocabulary";
import { fieldControlProps, fieldStateProps } from "./field";
import type { FieldDescriptor } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

type SwitchProps = Omit<JSX.IntrinsicElements["input"], "size" | "type"> & {
  field?: FieldDescriptor | undefined;
  /** Which side of the track the label sits on. */
  labelPlacement?: "before" | "after" | undefined;
  size?: Size | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
};

// `peer-focus-visible:` rather than `focus-ring-outset`: the track is the input's *sibling*, which `&:has()`
// cannot reach. The ring is outside it for that utility's reason — the track is the whole control.
const SWITCH_TRACK = cn(
  "relative shrink-0 rounded-selector bg-track peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50 motion-safe:transition-colors",
);
// Logical `start-0.5`, not physical `left-0.5`: under `dir="rtl"` the thumb must still rest at the
// inline start and travel to the inline end, which the physical pair mirrored the wrong way round.
// The travel is `translate-x-*`, which is physical whatever the writing mode, so it gets an `rtl:`
// twin rather than a logical spelling — there is none.
const SWITCH_THUMB = "absolute start-0.5 top-0.5 rounded-selector bg-background motion-safe:transition-transform";

const TRACK_SIZE = { sm: "h-4 w-7", md: "h-5 w-9", lg: "h-6 w-11" } as const;
const CHECKED = "[[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&]:";
const THUMB_SIZE = {
  sm: `size-3 ${CHECKED}translate-x-3 ${CHECKED}rtl:-translate-x-3`,
  md: `size-4 ${CHECKED}translate-x-4 ${CHECKED}rtl:-translate-x-4`,
  lg: `size-5 ${CHECKED}translate-x-5 ${CHECKED}rtl:-translate-x-5`,
} as const;

/** A labelled on/off toggle backed by a native checkbox with the `switch` role. @public */
export const Switch: FC<PropsWithChildren<SwitchProps>> = ({
  class: cls,
  field,
  children,
  labelPlacement = "after",
  size = "md",
  invalid = false,
  busy = false,
  "data-slot": inherited,
  ...props
}) => {
  const resolved = field ? fieldControlProps(props, field) : props;
  const state = fieldStateProps(invalid, busy);

  return (
    <label
      data-slot='switch'
      {...stateAttrs({ orientation: "horizontal" })}
      data-label-position={labelPlacement}
      {...presentationAttrs({ size })}
      class={cn("state-busy inline-flex items-center gap-2 state-invalid", labelPlacement === "before" && "flex-row-reverse", cls)}>
      {/* oxlint-disable-next-line jsx-a11y/role-has-required-aria-props -- a native checkbox supplies `aria-checked` from its own checkedness; writing it would desync on toggle. */}
      <input data-slot={slotToken("switch-input", inherited)} type='checkbox' role='switch' class='peer sr-only' {...resolved} {...state} />
      <span data-slot='switch-track' aria-hidden='true' class={cn(SWITCH_TRACK, TRACK_SIZE[size])}>
        <span data-slot='switch-thumb' class={cn(SWITCH_THUMB, THUMB_SIZE[size])} />
      </span>
      {children}
    </label>
  );
};
