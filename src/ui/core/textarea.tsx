import type { FC } from "hono/jsx";
import { cn } from "./utils/cn";

interface TextareaProps {
  id?: string;
  name?: string;
  rows?: number;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autocomplete?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  class?: string;
  children?: string;
}

export const Textarea: FC<TextareaProps> = ({ class: cls, children, ...props }) => (
  <textarea
    class={cn(
      "w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm text-brand-900 placeholder:text-brand-400",
      "focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20",
      "disabled:cursor-not-allowed disabled:opacity-50 resize-y",
      cls,
    )}
    {...props}
  >
    {children}
  </textarea>
);
