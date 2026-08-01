/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { stateAttrs } from "../state-attrs";
import { asClass, cn } from "./utils/cn";

type ProgressProps = Omit<JSX.IntrinsicElements["progress"], "children"> & { label?: string; orientation?: "horizontal" | "vertical" };

export const Progress: FC<ProgressProps> = ({ class: cls, label, "aria-label": ariaLabel, orientation = "horizontal", ...props }) => {
  const resolvedAriaLabel = ariaLabel ?? label;
  return (
    <progress
      data-slot='progress'
      {...stateAttrs({ orientation })}
      {...(resolvedAriaLabel !== undefined ? { "aria-label": resolvedAriaLabel } : {})}
      class={cn(orientation === "vertical" ? "w-2 h-full" : "h-2 w-full", "rounded-full", asClass(cls))}
      {...props}
    />
  );
};
