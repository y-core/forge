/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import type { Size } from "../contracts/types";
import { presentationAttrs } from "../contracts/vocabulary";
import { fieldControlProps, fieldStateProps } from "./field";
import type { FieldDescriptor } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { FIELD_SIZE } from "./utils/recipes";

type FileInputProps = Omit<JSX.IntrinsicElements["input"], "size" | "type"> & {
  field?: FieldDescriptor | undefined;
  size?: Size | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
};

const FILE_INPUT_BASE =
  "state-busy state-disabled state-invalid field-chrome focus-ring file:me-3 file:h-full file:border-0 file:bg-transparent file:font-medium file:text-foreground";

/** A styled `<input type="file">`, wired to a `FieldDescriptor` when one is passed. @public */
export const FileInput: FC<FileInputProps> = ({
  class: cls,
  field,
  size = "md",
  invalid = false,
  busy = false,
  "data-slot": inherited,
  ...props
}) => {
  const resolved = field ? fieldControlProps(props, field) : props;

  return (
    <input
      type='file'
      data-slot={slotToken("file-input", inherited)}
      {...presentationAttrs({ size })}
      class={cn(FILE_INPUT_BASE, FIELD_SIZE[size], cls)}
      {...resolved}
      {...fieldStateProps(invalid, busy)}
    />
  );
};
