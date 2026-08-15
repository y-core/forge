/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../jsx/types";

/** Props for {@link Resumable}. `children` is injected by `FC`. @public */
export interface ResumableProps {
  /** The scope's registered name — must match the client-side `registerScope`. */
  name: string;
  /** Optional element id on the scope root, so it can serve as a `commandfor` sink. */
  id?: string;
  /** Serializable initial state, rehydrated into signals on first interaction. */
  state?: Record<string, unknown>;
  /** Handle the scope's own setup addresses the root by, mapped to `data-ref`. */
  ref?: string;
  /** Classes for the scope root, which is a real box in its parent's layout. */
  class?: string;
}

/** Wraps SSR children in a resumable scope, resumed on first interaction with a descendant. @public */
export const Resumable: FC<ResumableProps> = ({ name, id, state, ref, class: cls, children }) => (
  <div
    data-scope={name}
    {...(id !== undefined ? { id } : {})}
    data-state={state ? JSON.stringify(state) : undefined}
    {...(ref !== undefined ? { "data-ref": ref } : {})}
    {...(cls !== undefined ? { class: cls } : {})}>
    {children}
  </div>
);
