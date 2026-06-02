import type { FC, JSX, PropsWithChildren } from "hono/jsx";
import { type FieldDescriptor, fieldControlProps } from "./field";
import { asClass, cn } from "./utils/cn";

type SelectProps = JSX.IntrinsicElements["select"] & { field?: FieldDescriptor };
type SelectOptionProps = JSX.IntrinsicElements["option"];
type SelectOptGroupProps = JSX.IntrinsicElements["optgroup"];

const SELECT_BASE =
  "w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground";
const SELECT_FOCUS = "focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20";
const SELECT_DISABLED = "disabled:cursor-not-allowed disabled:pointer-events-none";

export const Select: FC<PropsWithChildren<SelectProps>> = ({
  class: cls,
  field,
  children,
  ...props
}) => {
  const resolved = field ? fieldControlProps(props, field) : props;

  return (
    <div data-slot="select-wrapper" class="group/select relative w-full has-[select:disabled]:opacity-50">
      <select
        data-slot="select"
        class={cn(SELECT_BASE, SELECT_FOCUS, SELECT_DISABLED, asClass(cls))}
        {...resolved}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        data-slot="select-icon"
        class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"
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
  <optgroup data-slot="select-optgroup" class={asClass(cls)} {...props}>
    {children}
  </optgroup>
);
