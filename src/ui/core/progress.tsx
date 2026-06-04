import type { FC, JSX } from "hono/jsx";
import { asClass, cn } from "./utils/cn";

type ProgressProps = Omit<JSX.IntrinsicElements["progress"], "children"> & {
  label?: string;
};

export const Progress: FC<ProgressProps> = ({
  class: cls,
  label,
  "aria-label": ariaLabel,
  ...props
}) => (
  <progress
    data-slot="progress"
    aria-label={ariaLabel ?? label}
    class={cn("h-2 w-full rounded-full", asClass(cls))}
    {...props}
  />
);
