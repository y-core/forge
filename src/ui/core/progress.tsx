/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge */
import type { FC, JSX } from "../../jsx/types";
import { asClass, cn } from "./utils/cn";

type ProgressProps = Omit<JSX.IntrinsicElements["progress"], "children"> & { label?: string };

export const Progress: FC<ProgressProps> = ({ class: cls, label, "aria-label": ariaLabel, ...props }) => {
  const resolvedAriaLabel = ariaLabel ?? label;
  return (
    <progress
      data-slot='progress'
      {...(resolvedAriaLabel !== undefined ? { "aria-label": resolvedAriaLabel } : {})}
      class={cn("h-2 w-full rounded-full", asClass(cls))}
      {...props}
    />
  );
};
