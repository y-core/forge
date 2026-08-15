/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import type { FieldDescriptor } from "./field";
import { fieldControlProps } from "./field";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type TextareaProps = JSX.IntrinsicElements["textarea"] & { field?: FieldDescriptor };

// `field-sizing-content` makes `rows` stop determining the height, so the floor and the cap are not
// optional: without `min-h-16` every consumer passing `rows` gets a collapsed one-line box, and
// without `max-h-64` the control grows without bound.
const TEXTAREA_BASE =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground field-sizing-content min-h-16 max-h-64";
const TEXTAREA_FOCUS = "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20";
const TEXTAREA_DISABLED = "disabled:cursor-not-allowed disabled:opacity-50 resize-y";

/** A styled multi-line `<textarea>`, wired to a `FieldDescriptor` when one is passed. @public */
export const Textarea: FC<PropsWithChildren<TextareaProps>> = ({ class: cls, field, children, "data-slot": inherited, ...props }) => {
  const resolved = field ? fieldControlProps(props, field) : props;

  return (
    <textarea data-slot={slotToken("textarea", inherited)} class={cn(TEXTAREA_BASE, TEXTAREA_FOCUS, TEXTAREA_DISABLED, asClass(cls))} {...resolved}>
      {children}
    </textarea>
  );
};
