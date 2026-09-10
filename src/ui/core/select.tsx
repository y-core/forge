/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import type { Size } from "../contracts/types";
import { presentationAttrs } from "../contracts/vocabulary";
import { fieldControlProps, fieldStateProps } from "./field";
import type { FieldDescriptor } from "./types";
import type { ForgeIcon } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { FIELD_SIZE } from "./utils/recipes";

type SelectProps = Omit<JSX.IntrinsicElements["select"], "size"> & {
  field?: FieldDescriptor | undefined;
  icon: ForgeIcon<"chevron-down">;
  size?: Size | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
};
type SelectOptionProps = JSX.IntrinsicElements["option"];
type SelectOptGroupProps = JSX.IntrinsicElements["optgroup"];

// The caller's class dresses the wrapper, not the `<select>`, because the chevron is positioned
// against the wrapper's end edge: a width the two boxes did not share would strand it outside the
// control.
const SELECT_WRAPPER = "group/select relative w-full has-[select:disabled]:opacity-50";
const SELECT_BASE = "state-busy state-disabled state-invalid field-chrome appearance-none pe-10 focus-ring";

const SelectRoot: FC<PropsWithChildren<SelectProps>> = ({
  class: cls,
  field,
  icon: Icon,
  children,
  size = "md",
  invalid = false,
  busy = false,
  "data-slot": inherited,
  ...props
}) => {
  const resolved = field ? fieldControlProps(props, field) : props;

  return (
    <div data-slot='select-wrapper' class={cn(SELECT_WRAPPER, cls)}>
      <select
        data-slot={slotToken("select", inherited)}
        {...presentationAttrs({ size })}
        class={cn(SELECT_BASE, FIELD_SIZE[size])}
        {...resolved}
        {...fieldStateProps(invalid, busy)}>
        {children}
      </select>
      <span aria-hidden='true' data-slot='select-icon' class='pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground'>
        <Icon name='chevron-down' width={16} height={16} stroke='currentColor' stroke-width={1.5} stroke-linecap='round' stroke-linejoin='round' />
      </span>
    </div>
  );
};

const SelectOption: FC<PropsWithChildren<SelectOptionProps>> = ({ children, "data-slot": inherited, ...props }) => (
  <option data-slot={slotToken("select-option", inherited)} {...props}>
    {children}
  </option>
);

const SelectOptGroup: FC<PropsWithChildren<SelectOptGroupProps>> = ({ class: cls, children, "data-slot": inherited, ...props }) => {
  return (
    <optgroup data-slot={slotToken("select-optgroup", inherited)} class={cls} {...props}>
      {children}
    </optgroup>
  );
};

export const Select = Object.assign(SelectRoot, { Option: SelectOption, OptGroup: SelectOptGroup });
