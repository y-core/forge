/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import { slotToken } from "./utils/as-child";
import { asClass, cn } from "./utils/cn";

type FieldOrientation = "vertical" | "horizontal";

type FieldProps = Omit<JSX.IntrinsicElements["div"], "children"> & { label: JSXNode; orientation?: FieldOrientation };

const FIELD_LAYOUT: Record<FieldOrientation, string> = { vertical: "flex flex-col gap-1", horizontal: "flex items-center gap-2" };

/** A lightweight labelled control with a decorative `<span>` caption and no form semantics. @public */
export const Field: FC<PropsWithChildren<FieldProps>> = ({
  label,
  orientation = "vertical",
  class: cls,
  children,
  "data-slot": inherited,
  ...props
}) => (
  <div data-slot={slotToken("field", inherited)} {...stateAttrs({ orientation })} class={cn(FIELD_LAYOUT[orientation], asClass(cls))} {...props}>
    <span data-slot='field-label' class='text-xs font-medium text-muted-foreground'>
      {label}
    </span>
    {children}
  </div>
);
