/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { presentationAttrs } from "../contracts/vocabulary";
import type { Size, Tone } from "../contracts/vocabulary";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { cva } from "./utils/cva";
import { toneTokens } from "./utils/tone";

interface StatusProps extends Omit<JSX.IntrinsicElements["span"], "children"> {
  // Required, not optional: a dot carries its whole meaning in colour, and `role="img"` with no
  // name announces nothing at all.
  /** Accessible name for what the dot reports. */
  label: string;
  tone?: Tone | undefined;
  size?: Size | undefined;
}

// Module-level, as `tone.ts` writes its recipes: `--tone` is set by `toneTokens` on the same
// element, which the class-position colour rule cannot see.
const STATUS_DOT = "inline-block rounded-selector bg-(--tone)";

const statusDot = cva({ base: STATUS_DOT, variants: { size: { sm: "size-2", md: "size-2.5", lg: "size-3" } }, defaultVariants: { size: "md" } });

/** A coloured dot reporting a state, named by its required `label`. @public */
export const Status: FC<StatusProps> = ({ label, tone = "neutral", size = "md", class: cls, "data-slot": inherited, ...rest }) => (
  <span
    role='img'
    aria-label={label}
    data-slot={slotToken("status", inherited)}
    {...presentationAttrs({ tone })}
    class={cn(toneTokens(tone), statusDot({ size }), cls)}
    {...rest}
  />
);
