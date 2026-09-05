import { cloneElement, Fragment, isValidElement } from "../../../jsx/element";
import type { JSXElement, JSXNode } from "../../../jsx/types";
import { stateAttrs } from "../../contracts/state-attrs";
import { cn } from "./cn";

/** How a compound describes itself to {@link cloneAsChild}. */
export interface AsChildOptions {
  slot: string;
  class: string;
  props: Record<string, unknown>;
  type?: string | undefined;
  disabled?: boolean | undefined;
  /** Rendered inside the cloned child, before its own children. */
  prefix?: JSXNode;
  /** Rendered inside the cloned child, after its own children. */
  suffix?: JSXNode;
  message: string;
}

const present = (node: JSXNode | undefined): boolean => node !== undefined && node !== null;

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
  // A Fragment passes `isValidElement` but carries no attributes: cloning onto one drops every prop
  // silently, so it is rejected here on behalf of every call site rather than in each of them.
  if (!isValidElement(children) || children.type === Fragment) throw new Error(options.message);

  const rawClass = children.props.class;
  const childClass = typeof rawClass === "string" ? rawClass : undefined;
  const childType = typeof children.type === "string" ? children.type : undefined;
  const isButton = childType === "button";
  const childSlot = children.props["data-slot"];

  return cloneElement(children, {
    ...options.props,
    // The caller's `type` wins when they stated one, then the child's own, then `"button"`. A
    // compound that defaults `type` before it gets here can never take the child's branch, so a
    // child's `type="submit"` was overwritten and the form it sat in stopped submitting.
    ...(isButton ? definedEntries({ disabled: options.disabled, type: options.type ?? children.props.type ?? "button" }) : {}),
    // `disabled` is a button-only attribute, and `rest` carries it through on the compounds that do
    // not destructure it out — so without this an `<a>` came out `<a disabled aria-disabled="true">`,
    // with an attribute the platform ignores sitting beside the one that does the work.
    ...(!isButton ? { disabled: undefined, ...(options.disabled ? { "aria-disabled": "true", ...stateAttrs({ disabled: true }) } : {}) } : {}),
    ...(present(options.prefix) || present(options.suffix)
      ? { children: [options.prefix ?? null, children.props.children, options.suffix ?? null] }
      : {}),
    class: cn(options.class, childClass),
    "data-slot": typeof childSlot === "string" && childSlot ? slotToken(childSlot, options.slot) : options.slot,
  });
}
