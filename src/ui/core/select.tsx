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
import { FIELD_SIZE, FIELD_TEXT_SIZE } from "./utils/recipes";

type SelectProps = Omit<JSX.IntrinsicElements["select"], "size"> & {
  field?: FieldDescriptor | undefined;
  icon: ForgeIcon<"chevron-down">;
  size?: Size | undefined;
  rows?: number | undefined;
  invalid?: boolean | undefined;
  busy?: boolean | undefined;
};
type SelectOptionProps = JSX.IntrinsicElements["option"];
type SelectOptGroupProps = JSX.IntrinsicElements["optgroup"];

// The caller's class dresses the wrapper, not the `<select>`: the chevron is positioned against the
// wrapper's end edge, and a width the wrapper and the control did not share would strand it outside.
const SELECT_WRAPPER = "group/select relative w-full has-[select:disabled]:opacity-50";
const SELECT_CHROME = "state-busy state-disabled state-invalid field-chrome appearance-none";

const SelectRoot: FC<PropsWithChildren<SelectProps>> = ({
  class: cls,
  field,
  icon: Icon,
  children,
  size = "md",
  rows,
  invalid = false,
  busy = false,
  "data-slot": inherited,
  ...props
}) => {
  const resolved = field ? fieldControlProps(props, field) : props;
  // A multi-row listbox has no popup to point at, so it drops the chevron and the padding clearing
  // it. Rows are a floor, not a height: it fills the wrapper, the one box the caller's class dresses.
  const listbox = rows !== undefined;

  return (
    <div data-slot='select-wrapper' class={cn(SELECT_WRAPPER, cls)}>
      <select
        data-slot={slotToken("select", inherited)}
        {...presentationAttrs({ size })}
        {...(listbox ? { size: rows } : {})}
        class={cn(SELECT_CHROME, listbox ? "h-full" : "pe-10", "focus-ring", listbox ? FIELD_TEXT_SIZE[size] : FIELD_SIZE[size])}
        {...resolved}
        {...fieldStateProps(invalid, busy)}>
        {children}
      </select>
      {listbox ? null : (
        <span
          aria-hidden='true'
          data-slot='select-icon'
          class='pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted-foreground'>
          <Icon
            name='chevron-down'
            width={16}
            height={16}
            stroke='currentColor'
            stroke-width={1.5}
            stroke-linecap='round'
            stroke-linejoin='round'
          />
        </span>
      )}
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

/** Compound native `<select>` whose `.Option` and `.OptGroup` statics carry the field's slot tokens. @public */
export const Select = Object.assign(SelectRoot, { Option: SelectOption, OptGroup: SelectOptGroup });
