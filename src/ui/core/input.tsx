/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { applyFormat, INPUT_FORMAT_SCOPE } from "../contracts/input-format-contract";
import { presentationAttrs } from "../contracts/vocabulary";
import type { Size } from "../contracts/vocabulary";
import type { FieldDescriptor } from "./field";
import { fieldControlProps, fieldStateProps } from "./field";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { FIELD_SIZE } from "./utils/recipes";

type InputProps = Omit<JSX.IntrinsicElements["input"], "size"> & {
  field?: FieldDescriptor | undefined;
  format?: string | undefined;
  size?: Size | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
};

const INPUT_BASE = "state-busy state-disabled state-invalid field-chrome focus-ring";

/** A styled text `<input>`, wired to a `FieldDescriptor` when one is passed. @public */
export const Input: FC<InputProps> = ({
  class: cls,
  field,
  format,
  size = "md",
  invalid = false,
  busy = false,
  "data-slot": inherited,
  ...props
}) => {
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
      {...presentationAttrs({ size })}
      class={cn(INPUT_BASE, FIELD_SIZE[size], cls)}
      {...painted}
      {...fieldStateProps(invalid, busy)}
    />
  );
};
