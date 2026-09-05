/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { presentationAttrs } from "../contracts/vocabulary";
import type { Appearance, Size, Tone } from "../contracts/vocabulary";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { cva } from "./utils/cva";
import { toneVariants } from "./utils/tone";

/** The appearances a badge takes — a chip has no ghost or link form. @public */
export type BadgeAppearance = Extract<Appearance, "solid" | "soft" | "outline">;

type BadgeProps = JSX.IntrinsicElements["span"] & {
  tone?: Tone | undefined;
  appearance?: BadgeAppearance | undefined;
  size?: Extract<Size, "sm" | "md"> | undefined;
};

const badgeBox = cva({
  base: "inline-flex items-center rounded-selector border-field font-medium",
  variants: { size: { sm: "px-2 py-px text-[0.6875rem]", md: "px-2.5 py-0.5 text-xs" } },
  defaultVariants: { size: "md" },
});

/** A small pill-shaped label for a status, count, or category. @public */
export const Badge: FC<BadgeProps> = ({
  tone = "neutral",
  appearance = "soft",
  size = "md",
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => (
  <span
    data-slot={slotToken("badge", inherited)}
    {...presentationAttrs({ tone, appearance })}
    class={cn(badgeBox({ size }), toneVariants({ tone, appearance }), cls)}
    {...rest}>
    {children}
  </span>
);
