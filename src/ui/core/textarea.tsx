import type { FC, JSX, PropsWithChildren } from "hono/jsx";
import { useFieldControlProps } from "./field";
import { asClass, cn } from "./utils/cn";

type TextareaProps = JSX.IntrinsicElements["textarea"];

const TEXTAREA_BASE =
  "w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm text-brand-900 placeholder:text-brand-400";
const TEXTAREA_FOCUS = "focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20";
const TEXTAREA_DISABLED = "disabled:cursor-not-allowed disabled:opacity-50 resize-y";

export const Textarea: FC<PropsWithChildren<TextareaProps>> = ({
  class: cls,
  children,
  ...props
}) => {
  const fieldProps = useFieldControlProps(props);

  return (
    <textarea
      data-slot="textarea"
      class={cn(TEXTAREA_BASE, TEXTAREA_FOCUS, TEXTAREA_DISABLED, asClass(cls))}
      {...fieldProps}
    >
      {children}
    </textarea>
  );
};
