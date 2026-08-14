/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type ProgressProps = Omit<JSX.IntrinsicElements["progress"], "children"> & { label?: string; orientation?: "horizontal" | "vertical" };

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
      {...(resolvedAriaLabel !== undefined ? { "aria-label": resolvedAriaLabel } : {})}
      class={cn(orientation === "vertical" ? "w-2 h-full" : "h-2 w-full", "rounded-full", asClass(cls))}
      {...props}
    />
  );
};
