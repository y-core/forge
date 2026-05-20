import type { FC } from "hono/jsx";
import { cn } from "./utils/cn";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  id?: string;
  name?: string;
  options: SelectOption[];
  value?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  class?: string;
}

export const Select: FC<SelectProps> = ({
  class: cls,
  options,
  value,
  placeholder,
  ...props
}) => (
  <select
    class={cn(
      "w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm text-brand-900",
      "focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20",
      "disabled:cursor-not-allowed disabled:opacity-50",
      cls,
    )}
    {...props}
  >
    {placeholder && <option value="">{placeholder}</option>}
    {options.map((opt) => (
      <option key={opt.value} value={opt.value} selected={opt.value === value}>
        {opt.label}
      </option>
    ))}
  </select>
);
