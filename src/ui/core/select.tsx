import type { FC, JSX, PropsWithChildren } from "hono/jsx";
import { useFieldControlProps } from "./field";
import { cn } from "./utils/cn";

type SelectProps = JSX.IntrinsicElements["select"];
type SelectOptionProps = JSX.IntrinsicElements["option"];
type SelectOptGroupProps = JSX.IntrinsicElements["optgroup"];

export const Select: FC<PropsWithChildren<SelectProps>> = ({
  class: cls,
  children,
  ...props
}) => {
  const fieldProps = useFieldControlProps(props);
  const className = typeof cls === "string" ? cls : undefined;

  return (
    <div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50">
      <select
        data-slot="select"
        class={cn(
          "w-full appearance-none rounded-lg border border-brand-200 bg-white px-3 py-2 pr-10 text-sm text-brand-900",
          "focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20",
          "disabled:cursor-not-allowed disabled:pointer-events-none",
          className,
        )}
        {...fieldProps}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        data-slot="select-icon"
        class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-brand-600/60"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </span>
    </div>
  );
};

export const SelectOption: FC<PropsWithChildren<SelectOptionProps>> = ({ children, ...props }) => (
  <option data-slot="select-option" {...props}>
    {children}
  </option>
);

export const SelectOptGroup: FC<PropsWithChildren<SelectOptGroupProps>> = ({
  class: cls,
  children,
  ...props
}) => (
  <optgroup data-slot="select-optgroup" class={typeof cls === "string" ? cls : undefined} {...props}>
    {children}
  </optgroup>
);
