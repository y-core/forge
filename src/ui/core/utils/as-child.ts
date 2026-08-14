import { cloneElement, isValidElement } from "../../../jsx/element";
import type { JSXElement, JSXNode } from "../../../jsx/types";
import { stateAttrs } from "../../contracts/state-attrs";
import { asClass, cn } from "./cn";

/** How a compound describes itself to {@link cloneAsChild}. */
export interface AsChildOptions {
  slot: string;
  class: string;
  props: Record<string, unknown>;
  type?: string | undefined;
  disabled?: boolean | undefined;
  message: string;
}

// `cloneElement` shallow-merges: spreading `{ type: undefined }` onto `<button type="button">`
// erases the attribute and leaves a button that submits the surrounding form.
function definedEntries(candidates: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(candidates).filter(([, value]) => value !== undefined));
}

/** Compose a compound's own `data-slot` token with one it inherited through its props, own first. */
export function slotToken(own: string, inherited: unknown): string {
  return typeof inherited === "string" && inherited ? `${own} ${inherited}` : own;
}

/** Merge a compound's own attributes onto a caller-supplied element child. */
export function cloneAsChild(children: JSXNode, options: AsChildOptions): JSXElement {
  if (!isValidElement(children)) throw new Error(options.message);

  const childClass = asClass(children.props.class as string | undefined);
  const childType = typeof children.type === "string" ? children.type : undefined;
  const isButton = childType === "button";
  const childSlot = children.props["data-slot"];

  return cloneElement(children, {
    ...options.props,
    ...(isButton ? definedEntries({ disabled: options.disabled, type: options.type }) : {}),
    ...(options.disabled && !isButton ? { "aria-disabled": "true", ...stateAttrs({ disabled: true }) } : {}),
    class: cn(options.class, childClass),
    "data-slot": typeof childSlot === "string" && childSlot ? slotToken(childSlot, options.slot) : options.slot,
  });
}
