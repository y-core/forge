/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import { presentationAttrs } from "../contracts/vocabulary";
import type { Size } from "../contracts/vocabulary";
import type { FieldDescriptor } from "./field";
import { fieldControlProps, fieldStateProps } from "./field";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

type TextareaProps = JSX.IntrinsicElements["textarea"] & {
  field?: FieldDescriptor | undefined;
  size?: Size | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
};

// `h-auto` and the two bounds are what content sizing needs, not taste: `UI_SSR_COMPONENTS.md` §1i.
const TEXTAREA_BASE = "state-busy state-disabled state-invalid field-sizing-content field-chrome h-auto max-h-64 min-h-16 resize-y py-2 focus-ring";

/** The type scale only: a textarea's height is its content's, never its `Size`. */
const TEXTAREA_TEXT = { sm: "text-sm", md: "text-sm", lg: "text-base" } as const;

/** A styled multi-line `<textarea>`, wired to a `FieldDescriptor` when one is passed. @public */
export const Textarea: FC<PropsWithChildren<TextareaProps>> = ({
  class: cls,
  field,
  children,
  size = "md",
  invalid = false,
  busy = false,
  "data-slot": inherited,
  ...props
}) => {
  const resolved = field ? fieldControlProps(props, field) : props;

  return (
    <textarea
      data-slot={slotToken("textarea", inherited)}
      {...presentationAttrs({ size })}
      class={cn(TEXTAREA_BASE, TEXTAREA_TEXT[size], cls)}
      {...resolved}
      {...fieldStateProps(invalid, busy)}>
      {children}
    </textarea>
  );
};
