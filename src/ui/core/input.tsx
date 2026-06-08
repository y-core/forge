/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge */
import type { FC, JSX } from "../../jsx/types";
import type { FieldDescriptor } from "./field";
import { fieldControlProps } from "./field";
import { asClass, cn } from "./utils/cn";

type InputProps = JSX.IntrinsicElements["input"] & { field?: FieldDescriptor };

const INPUT_BASE = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground";
const INPUT_FOCUS = "focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20";
const INPUT_DISABLED = "disabled:cursor-not-allowed disabled:opacity-50";

export const Input: FC<InputProps> = ({ class: cls, field, ...props }) => {
  const resolved = field ? fieldControlProps(props, field) : props;

  return <input data-slot='input' class={cn(INPUT_BASE, INPUT_FOCUS, INPUT_DISABLED, asClass(cls))} {...resolved} />;
};
