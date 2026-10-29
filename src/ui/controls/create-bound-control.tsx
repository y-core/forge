/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import type { ComponentFn, FC, JSXElement } from "../../render/jsx/types";
import { aliasPart } from "../core/utils/part-props";
import { fieldAttr } from "../server/field-attr";

/** A `ui/core` component and the statics hung off it. @internal */
type Compound<P, S> = ((props: P) => JSXElement | null) & S;

function carry<F extends object, S extends object, O extends object>(wrapper: F, Core: S, overrides: O): F & Omit<S, keyof O> & O {
  return Object.assign(wrapper, { ...Core }, overrides) as F & Omit<S, keyof O> & O;
}

/** Wraps a `ui/core` control in one that adds a `bind` prop, carrying its statics over. @internal */
export function createBoundControl<P, S extends object, O extends object = Record<never, never>>(
  Core: Compound<P, S>,
  overrides: O = {} as O,
): FC<P & { bind: string }> & Omit<S, keyof O> & O {
  const Bound: FC<P & { bind: string }> = ({ bind, ...props }) => <Core {...(props as unknown as P)} {...fieldAttr(bind)} />;
  return carry(Bound, Core, overrides);
}

/** Wraps a `ui/core` compound whose binding lives on a static, not the root, carrying its statics over. @internal */
export function createBoundCompound<P, S extends object, O extends object = Record<never, never>>(
  Core: Compound<P, S>,
  overrides: O = {} as O,
): FC<P> & Omit<S, keyof O> & O {
  const Root: FC<P> = (props) => <Core {...props} />;
  for (const [key, override] of Object.entries(overrides)) {
    const part = (Core as Record<string, unknown>)[key];
    if (typeof override === "function" && typeof part === "function") aliasPart(override as ComponentFn, part as ComponentFn);
  }
  return carry(Root, Core, overrides);
}

/** Wraps a compound's `Item` so `bind` names its field, defaults its `name`, and stamps `data-value`. @internal */
export function createBoundItem<P extends { name: string; value: string }>(
  Item: FC<P>,
): FC<Omit<P, "name"> & { bind: string; name?: string | undefined }> {
  return ({ bind, value, name, ...props }) => (
    <Item {...(props as unknown as P)} name={name ?? bind} value={value} {...fieldAttr(bind)} data-value={value} />
  );
}
