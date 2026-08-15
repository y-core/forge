/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { FIELD_LABEL_CLASSES } from "./field";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

interface LabelProps extends Omit<JSX.IntrinsicElements["label"], "children"> {
  required?: boolean;
  children?: JSXNode;
}

/** A standalone `<label>`, appending a decorative required marker when `required` is set. @public */
export const Label: FC<LabelProps> = ({ required, class: cls, for: htmlFor, children, "data-slot": inherited, ...props }) => (
  <label data-slot={slotToken("label", inherited)} for={htmlFor} class={cn(FIELD_LABEL_CLASSES, asClass(cls))} {...props}>
    {children}
    {required ? (
      <span data-slot='label-required' aria-hidden='true' class='ms-0.5 text-destructive'>
        *
      </span>
    ) : null}
  </label>
);
