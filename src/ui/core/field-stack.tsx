/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { cloneElement, isValidElement } from "../../render/jsx/element";
import type { FC, JSX, JSXNode, PropsWithChildren } from "../../render/jsx/types";
import { stateAttrs } from "../contracts/state-attrs";
import { fieldControlId } from "./field";
import type { FieldDescriptor } from "./types";
import { slotToken } from "./utils/as-child";
import { cn } from "./utils/cn";

type FieldOrientation = "vertical" | "horizontal";

type FieldProps = Omit<JSX.IntrinsicElements["div"], "children"> & { label: JSXNode; orientation?: FieldOrientation | undefined };

const FIELD_LAYOUT: Record<FieldOrientation, string> = { vertical: "flex flex-col gap-1", horizontal: "flex items-center gap-2" };

const NAMING_PROPS = ["aria-label", "aria-labelledby"] as const;

function isDescriptor(value: unknown): value is FieldDescriptor {
  return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string";
}

function captionIdOf(child: JSXNode): string | undefined {
  if (!isValidElement(child) || NAMING_PROPS.some((prop) => child.props[prop] !== undefined)) {
    return undefined;
  }
  const { id, field } = child.props;
  const controlId = fieldControlId(typeof id === "string" ? id : undefined, isDescriptor(field) ? field : undefined);
  return controlId === undefined ? undefined : `${controlId}-label`;
}

/** A lightweight labelled row whose caption names the one control it wraps, with no form semantics. @public */
export const Field: FC<PropsWithChildren<FieldProps>> = ({
  label,
  orientation = "vertical",
  class: cls,
  children,
  "data-slot": inherited,
  ...props
}) => {
  const captionId = captionIdOf(children);
  return (
    <div data-slot={slotToken("field-stack", inherited)} {...stateAttrs({ orientation })} class={cn(FIELD_LAYOUT[orientation], cls)} {...props}>
      <span data-slot='field-stack-label' id={captionId} class='text-xs font-medium text-muted-foreground'>
        {label}
      </span>
      {isValidElement(children) && captionId !== undefined ? cloneElement(children, { "aria-labelledby": captionId }) : children}
    </div>
  );
};
