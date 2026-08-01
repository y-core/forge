import { cloneElement, isValidElement } from "../../../jsx/element";
import type { JSXElement, JSXNode } from "../../../jsx/types";
import { stateAttrs } from "../../contracts/state-attrs";
import { asClass, cn } from "./cn";

/**
 * The `asChild` model, extracted so every compound that offers it offers the *same* one.
 *
 * `asChild` says "render my styling and my behaviour onto the element I was given, instead of onto
 * one of your own". The rule that makes it safe is that the child must be **exactly one JSX
 * element**: a string, a fragment, an array or nothing has no props to merge into, and quietly
 * rendering a wrapper instead would give the caller a control that looks composed and is not. That
 * is a throw, never a degrade — the failure is in the caller's markup and is fixable there.
 */

/** How a compound describes itself to {@link cloneAsChild}. */
export interface AsChildOptions {
  /** `data-slot` stamped on the cloned child, so the composed element is still addressable. */
  slot: string;
  /** Classes the compound contributes; merged ahead of whatever the child brought. */
  class: string;
  /** Everything else the compound is passing through. */
  props: Record<string, unknown>;
  /** Native `type`, applied only when the child really is a `<button>`. */
  type?: string | undefined;
  /** Disabled state. A `<button>` gets the real attribute; anything else gets the ARIA equivalent
   * plus `data-disabled`, because `disabled` means nothing on an `<a>` or a `<div>`. */
  disabled?: boolean | undefined;
  /** Thrown when the child is not exactly one JSX element. Names the compound and the shapes it
   * accepts, since that is what the caller has to fix. */
  message: string;
}

/** Merge a compound's own attributes onto a caller-supplied element child. */
export function cloneAsChild(children: JSXNode, options: AsChildOptions): JSXElement {
  if (!isValidElement(children)) throw new Error(options.message);

  const childClass = asClass(children.props.class as string | undefined);
  const childType = typeof children.type === "string" ? children.type : undefined;
  const isButton = childType === "button";

  return cloneElement(children, {
    ...options.props,
    ...(isButton ? { disabled: options.disabled, type: options.type } : {}),
    ...(options.disabled && !isButton ? { "aria-disabled": "true", ...stateAttrs({ disabled: true }) } : {}),
    class: cn(options.class, childClass),
    "data-slot": options.slot,
  });
}
