/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode } from "../../jsx/types";
import { cloneAsChild, slotToken } from "./utils/as-child";
import { asClass } from "./utils/cn";
import { cva } from "./utils/cva";

export interface ButtonProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg" | "icon" | "icon-sm" | "square";
  asChild?: boolean;
  children?: JSXNode;
}

/** Resolves the shared button base, variant and size classes for every button-shaped component. @public */
export const buttonVariants = cva({
  base: "inline-flex items-center justify-center rounded-lg font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  variants: {
    variant: {
      primary: "bg-primary text-primary-foreground hover:bg-primary/90",
      secondary: "border border-input text-foreground hover:bg-accent",
      ghost: "text-foreground hover:bg-accent",
      destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    },
    size: {
      sm: "h-8 px-3 text-sm",
      md: "h-10 px-4 text-sm",
      lg: "h-12 px-6 text-base",
      icon: "size-9 p-0",
      "icon-sm": "size-8 p-0",
      square: "w-full aspect-square p-0",
    },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

export type ButtonSize = NonNullable<ButtonProps["size"]>;

/** A native `<button>`, or under `asChild` its props merged onto a single JSX element child. @public */
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
