/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import type { FieldDescriptor } from "./field";
import { fieldControlProps } from "./field";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type SwitchProps = Omit<JSX.IntrinsicElements["input"], "type"> & { field?: FieldDescriptor; orientation?: "label-before" | "label-after" };

const SWITCH_TRACK =
  "relative h-5 w-9 shrink-0 rounded-full bg-track motion-safe:transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50";
const SWITCH_THUMB =
  "absolute left-0.5 top-0.5 size-4 rounded-full bg-background motion-safe:transition-transform " +
  "[[data-slot~=switch-input]:checked~[data-slot~=switch-track]_&]:translate-x-4";

/** A labelled on/off toggle backed by a native checkbox with the `switch` role. @public */
export const Switch: FC<PropsWithChildren<SwitchProps>> = ({
  class: cls,
  field,
  children,
  orientation = "label-after",
  "data-slot": inherited,
  ...props
}) => {
  const resolved = field ? fieldControlProps(props, field) : props;

  return (
    <label
      data-slot='switch'
      {...stateAttrs({ orientation: "horizontal" })}
      data-label-position={orientation === "label-before" ? "before" : "after"}
      class={cn("inline-flex items-center gap-2", orientation === "label-before" && "flex-row-reverse", asClass(cls))}>
      {/* biome-ignore lint/a11y/useAriaPropsForRole: a native checkbox conveys checked-state to the switch role via its `checked` property — a static aria-checked would be wrong */}
      <input data-slot={slotToken("switch-input", inherited)} type='checkbox' role='switch' class='peer sr-only' {...resolved} />
      <span data-slot='switch-track' aria-hidden='true' class={SWITCH_TRACK}>
        <span data-slot='switch-thumb' class={SWITCH_THUMB} />
      </span>
      {children}
    </label>
  );
};
