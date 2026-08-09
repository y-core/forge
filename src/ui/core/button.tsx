/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { cloneAsChild, slotToken } from "./utils/as-child";
import { asClass } from "./utils/cn";
import { cva } from "./utils/cva";

export interface ButtonProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg" | "icon" | "icon-sm" | "square";
  asChild?: boolean;
  children?: JSXNode;
}

/**
 * The one button base in forge — every compound that renders a button-shaped thing resolves its
 * classes through this, rather than declaring a base string of its own. Exported for exactly that
 * reason: a second `ITEM_BASE` somewhere else is how a "ghost button" comes to mean two things.
 *
 * **`square` is not a fourth fixed box.** `icon` and `icon-sm` both name a size in pixels; `square`
 * names a *relationship* — take the width the parent gives you and be as tall as you are wide. An
 * app whose icon rail is a design token (44px, say) cannot express that with any fixed size, and
 * would otherwise have to override the class it just asked for.
 * @public
 */
export const buttonVariants = cva({
  base: "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  variants: {
    variant: {
      primary: "bg-primary text-primary-foreground hover:bg-primary/90",
      secondary: "border border-input text-foreground hover:bg-accent",
      ghost: "text-foreground hover:bg-accent",
    },
    size: {
      sm: "h-8 px-3 text-sm",
      md: "h-10 px-4 text-sm",
      lg: "h-12 px-6 text-base",
      icon: "size-9 p-0",
      "icon-sm": "size-[34px] p-0",
      square: "w-full aspect-square p-0",
    },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

export type ButtonSize = NonNullable<ButtonProps["size"]>;

export const Button: FC<ButtonProps> = ({
  variant,
  size,
  asChild = false,
  type = "button",
  disabled,
  class: cls,
  children,
  "data-slot": inherited,
  ...rest
}) => {
  const clsValue = asClass(cls);
  const className = buttonVariants({
    ...(variant !== undefined ? { variant } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(clsValue !== undefined ? { class: clsValue } : {}),
  });

  const slot = slotToken("button", inherited);

  if (asChild) {
    return cloneAsChild(children, {
      slot,
      class: className,
      props: rest,
      type,
      disabled,
      message:
        "Button with asChild requires exactly one JSX element child (e.g. <a> or <button>); received a string, number, fragment, array, or empty child instead.",
    }) as ReturnType<FC<ButtonProps>>;
  }

  return (
    <button type={type} data-slot={slot} class={className} {...(disabled !== undefined ? { disabled } : {})} {...rest}>
      {children}
    </button>
  );
};
