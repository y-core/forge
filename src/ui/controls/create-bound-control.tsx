/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, JSXElement } from "../../jsx/types";
import { fieldAttr } from "../server/field-attr";

/** A `ui/core` component and the statics hung off it. @internal */
type Compound<P, S> = ((props: P) => JSXElement | null) & S;

// A bound wrapper is a *new* function, so it starts with none of the core component's statics and
// `.Label` / `.Description` / `.Error` come back `undefined` unless something puts them there. That
// cannot be left to the caller: `NAMESPACES.md` §5b forbids importing the core twin alongside the
// bound one, so a forgotten static has no workaround at the call site at all. Copying them here is
// what makes the gap structurally impossible rather than fixed in whichever file last noticed it.
function carry<F extends object, S extends object, O extends object>(wrapper: F, Core: S, overrides: O): F & Omit<S, keyof O> & O {
  // Read off `Core`, which is never mutated — so an override named after a core static wraps the
  // original rather than itself, and an `Item` that re-entered would never terminate.
  return Object.assign(wrapper, { ...Core }, overrides) as F & Omit<S, keyof O> & O;
}

/** Wraps a `ui/core` control in one that adds a `bind` prop, carrying its statics over. @internal */
export function createBoundControl<P, S extends object, O extends object = Record<never, never>>(
  Core: Compound<P, S>,
  overrides: O = {} as O,
): FC<P & { bind: string }> & Omit<S, keyof O> & O {
  // `data-field` and nothing else. The per-control `data-on-*` action is gone: `bindControls`
  // listens once on the scope root, so the markup names the field and the runtime does the rest.
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
