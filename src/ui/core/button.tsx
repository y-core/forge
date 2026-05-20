import type { FC, PropsWithChildren } from "hono/jsx";
import { cva } from "./utils/cva";

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

interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  class?: string;
  "data-ref"?: string;
}

export const Button: FC<PropsWithChildren<ButtonProps>> = ({
  variant,
  size,
  type = "button",
  disabled,
  class: cls,
  children,
  ...rest
}) => (
  <button
    type={type}
    disabled={disabled}
    class={buttonVariants({ variant, size, class: cls })}
    {...rest}
  >
    {children}
  </button>
);
