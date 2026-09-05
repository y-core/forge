/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import type { Size } from "../contracts/vocabulary";
import { slotToken } from "./utils/as-child";
import { cva } from "./utils/cva";

type KbdProps = JSX.IntrinsicElements["kbd"] & { size?: Size | undefined };

const kbdBox = cva({
  base: "inline-flex items-center rounded-field border-field border-border bg-muted font-mono font-medium text-foreground shadow-xs",
  variants: { size: { sm: "px-1 py-px text-[0.6875rem]", md: "px-1.5 py-0.5 text-xs", lg: "px-2 py-1 text-sm" } },
  defaultVariants: { size: "md" },
});

/** A keyboard key rendered as a `<kbd>` chip. @public */
export const Kbd: FC<KbdProps> = ({ size = "md", class: cls, children, "data-slot": inherited, ...rest }) => (
  <kbd data-slot={slotToken("kbd", inherited)} class={kbdBox({ size, class: cls })} {...rest}>
    {children}
  </kbd>
);
