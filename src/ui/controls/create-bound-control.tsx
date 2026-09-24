/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSXElement } from "../../jsx/types";
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
  const Bound: FC<P & { bind: string }> = ({ bind, ...props }) => <Core {...(props as P)} {...fieldAttr(bind)} />;
  return carry(Bound, Core, overrides);
}

/** Wraps a `ui/core` compound whose binding lives on a static, not the root, carrying its statics over. @internal */
export function createBoundCompound<P, S extends object, O extends object = Record<never, never>>(
  Core: Compound<P, S>,
  overrides: O = {} as O,
): FC<P> & Omit<S, keyof O> & O {
  const Root: FC<P> = (props) => <Core {...props} />;
  return carry(Root, Core, overrides);
}
