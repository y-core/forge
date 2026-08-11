/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, PropsWithChildren } from "../../jsx/types";
import type { FieldDescriptor } from "./field";
import { fieldControlProps } from "./field";
import type { ForgeIcon } from "./icon";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type SelectProps = JSX.IntrinsicElements["select"] & { field?: FieldDescriptor; icon: ForgeIcon<"chevron-down"> };
type SelectOptionProps = JSX.IntrinsicElements["option"];
type SelectOptGroupProps = JSX.IntrinsicElements["optgroup"];

const SELECT_WRAPPER = "group/select relative w-full has-[select:disabled]:opacity-50";
const SELECT_BASE = "w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground";
const SELECT_FOCUS = "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20";
const SELECT_DISABLED = "disabled:cursor-not-allowed disabled:pointer-events-none";

const SelectRoot: FC<PropsWithChildren<SelectProps>> = ({ class: cls, field, icon: Icon, children, "data-slot": inherited, ...props }) => {
  const resolved = field ? fieldControlProps(props, field) : props;

  return (
    // The wrapper is the element with the geometry — width, position, the chevron's containing
    // block — so a caller's `class` has to land here to size the control as laid out.
    <div data-slot='select-wrapper' class={cn(SELECT_WRAPPER, asClass(cls))}>
      <select data-slot={slotToken("select", inherited)} class={`${SELECT_BASE} ${SELECT_FOCUS} ${SELECT_DISABLED}`} {...resolved}>
        {children}
      </select>
      <span
        aria-hidden='true'
        data-slot='select-icon'
        class='pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground'>
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
  const clsValue = asClass(cls);
  return (
    <optgroup data-slot={slotToken("select-optgroup", inherited)} {...(clsValue !== undefined ? { class: clsValue } : {})} {...props}>
      {children}
    </optgroup>
  );
};

export const Select = Object.assign(SelectRoot, { Option: SelectOption, OptGroup: SelectOptGroup });
