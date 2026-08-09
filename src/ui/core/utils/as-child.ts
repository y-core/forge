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
  /** `data-slot` token contributed to the cloned child, so the composed element is still addressable.
   * Appended to whatever slot the child already declared rather than replacing it — see
   * {@link cloneAsChild}. */
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

/**
 * Drop the keys the compound never set.
 *
 * `cloneElement` shallow-merges, so a key present with an `undefined` value still wins over the
 * child's own — spreading `{ type: undefined }` onto `<button type="button">` erases the attribute
 * and leaves a button that submits the surrounding form.
 */
function definedEntries(candidates: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(candidates).filter(([, value]) => value !== undefined));
}

/**
 * Compose a compound's own `data-slot` token with one it inherited through its props.
 *
 * Every compound renders its literal `data-slot` *before* its `{...rest}` spread, so a token handed
 * down by an outer compound — which arrives as an ordinary prop — would otherwise replace the inner
 * one's and silently unmake the element it was composed onto. Both are kept, own first, because the
 * element genuinely is both compounds at once.
 *
 * `inherited` is `unknown` because it comes from a caller-supplied prop bag: anything that is not a
 * non-empty string contributes no token rather than stringifying into the attribute. `own` is the
 * compound's own literal and is expected to be non-empty.
 *
 * @example
 * ```ts
 * slotToken("menu-trigger", "tooltip-trigger"); // "menu-trigger tooltip-trigger"
 * slotToken("menu-trigger", undefined);         // "menu-trigger"
 * ```
 */
export function slotToken(own: string, inherited: unknown): string {
  return typeof inherited === "string" && inherited ? `${own} ${inherited}` : own;
}

/**
 * Merge a compound's own attributes onto a caller-supplied element child.
 *
 * **`data-slot` is a token list, not a single value.** Composing two compounds produces one element
 * that genuinely is both — `<Tooltip.Trigger asChild><Menu.Trigger/></Tooltip.Trigger>` renders one
 * button that is a tooltip trigger *and* a menu trigger — so the outer compound appends its token
 * rather than overwriting the inner one's. Overwriting silently unmakes the child: every
 * `[data-slot~="menu-trigger"]` rule stops matching, and the menu loses the `anchor-name` that
 * positions its popup. Forge's own selectors use `~=`, which has the same specificity as `=` and so
 * changes nothing about the cascade; a consumer keying on `[data-slot="…"]` exactly must do the same.
 */
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
