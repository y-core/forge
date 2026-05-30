import type { Child, FC, JSX } from "hono/jsx";
import { cloneElement, isValidElement } from "hono/jsx";
import { asClass, cn } from "./utils/cn";
import { cva } from "./utils/cva";

interface ButtonProps extends Omit<JSX.IntrinsicElements["button"], "children"> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  asChild?: boolean;
  children?: Child;
}

const buttonVariants = cva({
  base: "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:pointer-events-none disabled:opacity-50",
  variants: {
    variant: {
      primary: "bg-brand-600 text-white hover:bg-brand-800",
      secondary: "border border-brand-600 text-brand-600 hover:bg-brand-50",
      ghost: "text-brand-600 hover:bg-brand-100",
    },
    size: {
      sm: "h-8 px-3 text-sm",
      md: "h-10 px-4 text-sm",
      lg: "h-12 px-6 text-base",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "md",
  },
});

export const Button: FC<ButtonProps> = ({
  variant,
  size,
  asChild = false,
  type = "button",
  disabled,
  class: cls,
  children,
  ...rest
}) => {
  const className = buttonVariants({ variant, size, class: asClass(cls) });

  if (asChild) {
    if (!isValidElement(children)) {
      throw new Error("Button with asChild expects a single valid JSX element child.");
    }

    const childClass = asClass(children.props.class);
    const childTag = typeof children.tag === "string" ? children.tag : undefined;

    return cloneElement(children, {
      ...rest,
      ...(childTag === "button" ? { disabled, type } : {}),
      ...(disabled && childTag !== "button"
        ? { "aria-disabled": "true", "data-disabled": "true" }
        : {}),
      class: cn(className, childClass),
      "data-slot": "button",
    }) as unknown as ReturnType<FC<ButtonProps>>;
  }

  return (
    <button
      type={type}
      disabled={disabled}
      data-slot="button"
      class={className}
      {...rest}
    >
      {children}
    </button>
  );
};
