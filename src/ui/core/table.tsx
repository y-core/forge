/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import type { Size, Tone } from "../contracts/types";
import { presentationAttrs } from "../contracts/vocabulary";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";
import { cva } from "./utils/cva";
import { toneVariants } from "./utils/tone";

type TableProps = JSX.IntrinsicElements["table"] & { size?: Size | undefined; zebra?: boolean | undefined; pinRows?: boolean | undefined };

type TableRowProps = JSX.IntrinsicElements["tr"] & { tone?: Tone | undefined; selected?: boolean | undefined };

// Cell density is written as `[&_th]`/`[&_td]` variants on the table: SSR has no way to hand a
// size down to a cell that renders as its own component call.
const tableBox = cva({
  base: "w-full border-collapse text-sm",
  variants: {
    size: {
      sm: "text-xs [&_td]:px-3 [&_td]:py-1.5 [&_th]:px-3 [&_th]:py-1.5",
      md: "text-sm [&_td]:px-4 [&_td]:py-2 [&_th]:px-4 [&_th]:py-2",
      lg: "text-base [&_td]:px-5 [&_td]:py-3 [&_th]:px-5 [&_th]:py-3",
    },
  },
  defaultVariants: { size: "md" },
});

const TableRoot: FC<TableProps> = ({ size = "md", zebra = false, pinRows = false, class: cls, children, "data-slot": inherited, ...rest }) => (
  <div data-slot='table-scroll' class='overflow-auto rounded-box border-field border-border'>
    <table
      data-slot={slotToken("table", inherited)}
      {...presentationAttrs({ size })}
      class={cn(
        tableBox({ size }),
        zebra && "[&_tbody_tr:nth-child(even)]:bg-muted/40",
        pinRows && "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:bg-background",
        cls,
      )}
      {...rest}>
      {children}
    </table>
  </div>
);

const TableHeader: FC<JSX.IntrinsicElements["thead"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <thead data-slot={slotToken("table-header", inherited)} class={cls} {...rest}>
    {children}
  </thead>
);

const TableBody: FC<JSX.IntrinsicElements["tbody"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <tbody data-slot={slotToken("table-body", inherited)} class={cls} {...rest}>
    {children}
  </tbody>
);

const TableFooter: FC<JSX.IntrinsicElements["tfoot"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <tfoot data-slot={slotToken("table-footer", inherited)} class={cls} {...rest}>
    {children}
  </tfoot>
);

// `aria-selected` is tri-state on purpose: absent means the table is not selectable at all, so it is
// emitted — `"false"` included — exactly when the caller passed `selected`. The tint alone is a
// `forge-ui-not-color-alone` failure, and `forced-colors` overrides the tint outright.
const TableRow: FC<TableRowProps> = ({ tone, selected, class: cls, children, "data-slot": inherited, ...rest }) => (
  <tr
    data-slot={slotToken("table-row", inherited)}
    {...presentationAttrs({ tone })}
    {...(selected === undefined ? {} : { "aria-selected": selected })}
    {...stateAttrs({ selected: selected ?? false })}
    class={cn("border-b border-border last:border-b-0", tone ? toneVariants({ tone, appearance: "soft" }) : "", selected && "bg-primary-soft", cls)}
    {...rest}>
    {children}
  </tr>
);

const TableHead: FC<JSX.IntrinsicElements["th"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <th data-slot={slotToken("table-head", inherited)} class={cn("text-start font-medium text-muted-foreground", cls)} {...rest}>
    {children}
  </th>
);

const TableCell: FC<JSX.IntrinsicElements["td"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <td data-slot={slotToken("table-cell", inherited)} class={cls} {...rest}>
    {children}
  </td>
);

const TableCaption: FC<JSX.IntrinsicElements["caption"]> = ({ class: cls, children, "data-slot": inherited, ...rest }) => (
  <caption data-slot={slotToken("table-caption", inherited)} class={cn("mt-2 caption-bottom text-sm text-muted-foreground", cls)} {...rest}>
    {children}
  </caption>
);

/** A data table on the shape tokens, with `Header`, `Body`, `Footer`, `Row`, `Head`, `Cell`, and `Caption` subcomponents. @public */
export const Table = Object.assign(TableRoot, {
  Header: TableHeader,
  Body: TableBody,
  Footer: TableFooter,
  Row: TableRow,
  Head: TableHead,
  Cell: TableCell,
  Caption: TableCaption,
});
