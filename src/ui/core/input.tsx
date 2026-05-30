import type { FC, JSX } from "hono/jsx";
import { useFieldControlProps } from "./field";
import { asClass, cn } from "./utils/cn";

type InputProps = JSX.IntrinsicElements["input"];

const INPUT_BASE =
  "w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm text-brand-900 placeholder:text-brand-400";
const INPUT_FOCUS = "focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20";
const INPUT_DISABLED = "disabled:cursor-not-allowed disabled:opacity-50";

export const Input: FC<InputProps> = ({ class: cls, ...props }) => {
  const fieldProps = useFieldControlProps(props);

  return (
    <input
      data-slot="input"
      class={cn(INPUT_BASE, INPUT_FOCUS, INPUT_DISABLED, asClass(cls))}
      {...fieldProps}
    />
  );
};
