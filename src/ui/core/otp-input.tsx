/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import type { Size } from "../contracts/types";
import { presentationAttrs } from "../contracts/vocabulary";
import { fieldControlProps, fieldStateProps } from "./field";
import type { FieldDescriptor } from "./types";
import type { OtpLength } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

type OtpInputProps = Omit<JSX.IntrinsicElements["input"], "size" | "type" | "maxlength" | "children"> & {
  field?: FieldDescriptor | undefined;
  length?: OtpLength | undefined;
  size?: Size | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
};

// Two elements, because one cannot be both: the cell grid must end where the field's border does,
// and the editor has to run `--otp-pad` past that end to hold the caret after the last glyph's own
// letter-spacing. The frame paints the grid and clips; the editor overhangs it, unseen.
const FRAME = "state-disabled state-invalid focus-ring otp-cells inline-flex overflow-clip rounded-field border-field border-input bg-background";
const EDITOR = "state-busy otp-editor h-full shrink-0 border-0 bg-transparent font-mono text-foreground outline-none tabular-nums";

const FRAME_SIZE: Record<Size, string> = { sm: "h-control-sm", md: "h-control-md", lg: "h-control-lg" };
const EDITOR_SIZE: Record<Size, string> = { sm: "text-sm", md: "text-base", lg: "text-lg" };

// Literals, never a template: Tailwind scans source, and only a class spelled out here compiles.
const LENGTH_CLASS: Record<OtpLength, string> = {
  4: "[--otp-length:4]",
  5: "[--otp-length:5]",
  6: "[--otp-length:6]",
  7: "[--otp-length:7]",
  8: "[--otp-length:8]",
};

/** One native `<input autocomplete="one-time-code">` painted as digit cells — one field, one value, native paste and autofill. @public */
export const OtpInput: FC<OtpInputProps> = ({
  class: cls,
  field,
  length = 6,
  size = "md",
  invalid = false,
  busy = false,
  "data-slot": inherited,
  ...props
}) => {
  const resolved = field ? fieldControlProps(props, field) : props;
  return (
    <div data-slot='otp-input-wrapper' {...presentationAttrs({ size })} class={cn(FRAME, FRAME_SIZE[size], LENGTH_CLASS[length], cls)}>
      <input
        data-slot={slotToken("otp-input", inherited)}
        type='text'
        inputmode='numeric'
        autocomplete='one-time-code'
        pattern='[0-9]*'
        maxlength={length}
        {...presentationAttrs({ size })}
        class={cn(EDITOR, EDITOR_SIZE[size])}
        {...resolved}
        {...fieldStateProps(invalid, busy)}
      />
    </div>
  );
};
