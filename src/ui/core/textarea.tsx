import type { FC, JSX, PropsWithChildren } from "hono/jsx";
import { useFieldControlProps } from "./field";
import { cn } from "./utils/cn";

type TextareaProps = JSX.IntrinsicElements["textarea"];

export const Textarea: FC<PropsWithChildren<TextareaProps>> = ({
  class: cls,
  children,
  ...props
}) => {
  const fieldProps = useFieldControlProps(props);
  const className = typeof cls === "string" ? cls : undefined;

  return (
    <textarea
      data-slot="textarea"
      class={cn(
        "w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm text-brand-900 placeholder:text-brand-400",
        "focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20",
        "disabled:cursor-not-allowed disabled:opacity-50 resize-y",
        className,
      )}
      {...fieldProps}
    >
      {children}
    </textarea>
  );
};
