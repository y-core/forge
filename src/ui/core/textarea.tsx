/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import type { FieldDescriptor } from "./field";
import { fieldControlProps } from "./field";
import { asClass, cn } from "./utils/cn";

type TextareaProps = JSX.IntrinsicElements["textarea"] & { field?: FieldDescriptor };

const TEXTAREA_BASE = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground";
const TEXTAREA_FOCUS = "focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20";
const TEXTAREA_DISABLED = "disabled:cursor-not-allowed disabled:opacity-50 resize-y";

export const Textarea: FC<PropsWithChildren<TextareaProps>> = ({ class: cls, field, children, ...props }) => {
  const resolved = field ? fieldControlProps(props, field) : props;

  return (
    <textarea data-slot='textarea' class={cn(TEXTAREA_BASE, TEXTAREA_FOCUS, TEXTAREA_DISABLED, asClass(cls))} {...resolved}>
      {children}
    </textarea>
  );
};
