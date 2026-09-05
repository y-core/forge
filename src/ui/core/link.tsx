/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { presentationAttrs } from "../contracts/vocabulary";
import type { Tone } from "../contracts/vocabulary";
import { cloneAsChild, slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { cva } from "./utils/cva";
import { toneTokens } from "./utils/tone";

/** How a link marks itself as one — always underlined, underlined on hover, or never. Not the
 *  ratified `appearance` axis, which is an emphasis level: this decides text decoration. @public */
export type LinkDecoration = "underline" | "hover" | "plain";

export interface LinkProps extends Omit<JSX.IntrinsicElements["a"], "children"> {
  tone?: Tone | undefined;
  decoration?: LinkDecoration | undefined;
  asChild?: boolean | undefined;
  children?: JSXNode | undefined;
}

// Module-level, as `tone.ts` writes its recipes: `--tone-text` is set by `toneTokens` on the same
// element, which the class-position colour rule cannot see.
const LINK_BASE = "rounded-sm text-(--tone-text) focus-ring-outset";

const linkBox = cva({
  base: LINK_BASE,
  variants: { decoration: { underline: "underline underline-offset-4", hover: "no-underline hover:underline", plain: "no-underline" } },
  defaultVariants: { decoration: "underline" },
});

/** A styled `<a>`, or under `asChild` its props merged onto a single JSX element child. @public */
export const Link: FC<LinkProps> = ({
  tone = "primary",
  decoration = "underline",
  asChild = false,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  const className = cn(toneTokens(tone), linkBox({ decoration }), cls);
  const slot = slotToken("link", inherited);

  if (asChild) {
    return cloneAsChild(children, {
      slot,
      class: className,
      props: { ...presentationAttrs({ tone }), "data-decoration": decoration, ...rest },
      message:
        "Link with asChild requires exactly one JSX element child (e.g. an <a> from a router); received a string, number, fragment, array, or empty child instead.",
    }) as ReturnType<FC<LinkProps>>;
  }

  return (
    <a data-slot={slot} {...presentationAttrs({ tone })} data-decoration={decoration} class={className} {...rest}>
      {children}
    </a>
  );
};
