import { cloneElement, Fragment, isValidElement } from "../../../jsx/element";
import type { JSXElement, JSXNode } from "../../../jsx/types";
import { stateAttrs } from "../../contracts/state-attrs";
import { cn } from "./cn";
import type { AsChildOptions } from "./types";

const present = (node: JSXNode | undefined): boolean => node !== undefined && node !== null;

// `cloneElement` shallow-merges: spreading `{ type: undefined }` onto `<button type="button">`
// erases the attribute and leaves a button that submits the surrounding form.
function definedEntries(candidates: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(candidates).filter(([, value]) => value !== undefined));
}

/** Compose a compound's own `data-slot` token with one it inherited through its props, own first. */
export function slotToken(own: string, inherited?: unknown): string {
  return typeof inherited === "string" && inherited ? `${own} ${inherited}` : own;
}

/** What makes an anchor inert without making it unreachable: nowhere to navigate, still a focus stop. @internal */
// `aria-disabled` is advisory on an anchor — the platform follows `href` on Enter regardless — so the
// href is what has to go, and `role`/`tabindex` are what keep the row announced and arrowed onto.
export const INERT_ANCHOR_PROPS = { href: undefined, role: "link", tabindex: 0 } as const;

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
  // Either spelling makes an anchor inert: `disabled` from the compound, or an `aria-disabled` the
  // compound already resolved into the props it is merging.
  const ariaDisabled = options.props["aria-disabled"];
  const inert = options.disabled === true || ariaDisabled === true || ariaDisabled === "true";

  return cloneElement(children, {
    ...options.props,
    // The caller's `type` wins, then the child's own, then `"button"`: a compound that defaults
    // `type` before this point would overwrite a child's `type="submit"`.
    ...(isButton ? definedEntries({ disabled: options.disabled, type: options.type ?? children.props.type ?? "button" }) : {}),
    // `disabled` is button-only, and `rest` carries it through on compounds that do not destructure
    // it out, so an `<a>` would come out `<a disabled aria-disabled="true">`.
    ...(!isButton ? { disabled: undefined, ...(options.disabled ? { "aria-disabled": "true", ...stateAttrs({ disabled: true }) } : {}) } : {}),
    ...(childType === "a" && inert ? INERT_ANCHOR_PROPS : {}),
    ...(present(options.prefix) || present(options.suffix)
      ? { children: [options.prefix ?? null, children.props.children, options.suffix ?? null] }
      : {}),
    class: cn(options.class, childClass),
    "data-slot": typeof childSlot === "string" && childSlot ? slotToken(childSlot, options.slot) : options.slot,
  });
}
