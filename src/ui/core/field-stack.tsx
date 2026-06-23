/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../jsx/types";
import { asClass, cn } from "./utils/cn";

type FieldOrientation = "vertical" | "horizontal";

type FieldProps = Omit<JSX.IntrinsicElements["div"], "children"> & { label: JSXNode; orientation?: FieldOrientation };

const FIELD_LAYOUT: Record<FieldOrientation, string> = { vertical: "flex flex-col gap-1", horizontal: "flex items-center gap-2" };

/**
 * A lightweight labelled control: a caption tightly bound to its control, *without* the
 * form-semantics (`<fieldset>`, validation, error/description wiring) of `FormField`. Use it for
 * settings rows and labelled inputs that aren't a validated form field. The label renders as a
 * decorative `<span>`; pass any control as `children`. Theme-token styled and `class`-overridable.
 * @public
 */
export const Field: FC<PropsWithChildren<FieldProps>> = ({ label, orientation = "vertical", class: cls, children, ...props }) => (
  <div data-slot='field' data-orientation={orientation} class={cn(FIELD_LAYOUT[orientation], asClass(cls))} {...props}>
    <span data-slot='field-label' class='text-xs font-medium text-muted-foreground'>
      {label}
    </span>
    {children}
  </div>
);
