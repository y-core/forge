/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import type { FieldDescriptor } from "./field";
import { fieldControlProps } from "./field";
import { asClass, cn } from "./utils/cn";

type SwitchProps = Omit<JSX.IntrinsicElements["input"], "type"> & { field?: FieldDescriptor };

const SWITCH_TRACK =
  "relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50";
const SWITCH_THUMB = "absolute left-0.5 top-0.5 size-4 rounded-full bg-background transition-transform peer-checked:translate-x-4";

export const Switch: FC<PropsWithChildren<SwitchProps>> = ({ class: cls, field, children, ...props }) => {
  const resolved = field ? fieldControlProps(props, field) : props;

  return (
    <label data-slot='switch' class={cn("inline-flex items-center gap-2", asClass(cls))}>
      {/* biome-ignore lint/a11y/useAriaPropsForRole: a native checkbox conveys checked-state to the switch role via its `checked` property — a static aria-checked would be wrong */}
      <input data-slot='switch-input' type='checkbox' role='switch' class='peer sr-only' {...resolved} />
      <span data-slot='switch-track' aria-hidden='true' class={SWITCH_TRACK}>
        <span data-slot='switch-thumb' class={SWITCH_THUMB} />
      </span>
      {children}
    </label>
  );
};
