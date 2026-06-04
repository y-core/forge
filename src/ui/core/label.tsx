import type { Child, FC, JSX } from "hono/jsx";
import { FIELD_LABEL_CLASSES } from "./field";
import { asClass, cn } from "./utils/cn";

interface LabelProps extends Omit<JSX.IntrinsicElements["label"], "children"> {
  required?: boolean;
  children?: Child;
}

export const Label: FC<LabelProps> = ({
  required,
  class: cls,
  for: htmlFor,
  children,
  ...props
}) => (
  <label
    data-slot="label"
    for={htmlFor}
    class={cn(FIELD_LABEL_CLASSES, asClass(cls))}
    {...props}
  >
    {children}
    {required ? (
      <span data-slot="label-required" aria-hidden="true" class="ml-0.5 text-red-500">
        *
      </span>
    ) : null}
  </label>
);
