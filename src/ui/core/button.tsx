import { cloneElement, isValidElement } from "../../jsx/element";
import type { Child, FC, JSX } from "../../jsx/types";
import { asClass, cn } from "./utils/cn";
import { cva } from "./utils/cva";

interface ButtonProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  asChild?: boolean;
  children?: Child;
}

const buttonVariants = cva({
  base: "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  variants: {
    variant: {
      primary: "bg-primary text-primary-foreground hover:bg-primary/90",
      secondary: "border border-input text-foreground hover:bg-accent",
      ghost: "text-foreground hover:bg-accent",
    },
    size: { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

export const Button: FC<ButtonProps> = ({ variant, size, asChild = false, type = "button", disabled, class: cls, children, ...rest }) => {
  const clsValue = asClass(cls);
  const className = buttonVariants({
    ...(variant !== undefined ? { variant } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(clsValue !== undefined ? { class: clsValue } : {}),
  });

  if (asChild) {
    if (!isValidElement(children)) {
      throw new Error("Button with asChild expects a single valid JSX element child.");
    }

    const childClass = asClass(children.props.class as string | undefined);
    const childType = typeof children.type === "string" ? children.type : undefined;

    return cloneElement(children, {
      ...rest,
      ...(childType === "button" ? { disabled, type } : {}),
      ...(disabled && childType !== "button" ? { "aria-disabled": "true", "data-disabled": "true" } : {}),
      class: cn(className, childClass),
      "data-slot": "button",
    }) as ReturnType<FC<ButtonProps>>;
  }

  return (
    <button type={type} data-slot='button' class={className} {...(disabled !== undefined ? { disabled } : {})} {...rest}>
      {children}
    </button>
  );
};
