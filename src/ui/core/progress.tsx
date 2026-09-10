/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import type { Orientation } from "../contracts/types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

type ProgressProps = Omit<JSX.IntrinsicElements["progress"], "children"> & { label?: string | undefined; orientation?: Orientation | undefined };

/** A native `<progress>` bar for a task with a known total, horizontal or vertical. @public */
export const Progress: FC<ProgressProps> = ({
  class: cls,
  label,
  "aria-label": ariaLabel,
  orientation = "horizontal",
  "data-slot": inherited,
  ...props
}) => {
  const resolvedAriaLabel = ariaLabel ?? label;
  return (
    <progress
      data-slot={slotToken("progress", inherited)}
      {...stateAttrs({ orientation })}
      aria-label={resolvedAriaLabel}
      class={cn(
        orientation === "vertical" ? "h-full w-2 [direction:rtl] [writing-mode:vertical-lr]" : "h-2 w-full",
        "appearance-none rounded-selector bg-border",
        cls,
      )}
      {...props}
    />
  );
};
