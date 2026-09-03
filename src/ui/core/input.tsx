/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { applyFormat, INPUT_FORMAT_SCOPE } from "../contracts/input-format-contract";
import type { FieldDescriptor } from "./field";
import { fieldControlProps } from "./field";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type InputProps = JSX.IntrinsicElements["input"] & { field?: FieldDescriptor; format?: string };

const INPUT_BASE = cn("w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground");
const INPUT_FOCUS = cn("focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none");
const INPUT_DISABLED = cn("disabled:cursor-not-allowed disabled:opacity-50");

/** A styled text `<input>`, wired to a `FieldDescriptor` when one is passed. @public */
export const Input: FC<InputProps> = ({ class: cls, field, format, "data-slot": inherited, ...props }) => {
  const resolved = field ? fieldControlProps(props, field) : props;
  // The server paints the formatted value itself, so a no-JS render and a post-blur render agree by construction.
  const painted =
    format && (typeof resolved.value === "string" || typeof resolved.value === "number")
      ? { ...resolved, value: applyFormat(format, String(resolved.value)) }
      : resolved;

  return (
    <input
      data-slot={slotToken("input", inherited)}
      data-scope={format ? INPUT_FORMAT_SCOPE : undefined}
      data-format={format || undefined}
      class={cn(INPUT_BASE, INPUT_FOCUS, INPUT_DISABLED, asClass(cls))}
      {...painted}
    />
  );
};
