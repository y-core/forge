/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../jsx/types";
import { ISLAND_STATE_ATTR } from "../contracts/island-contract";

/** Props for {@link Resumable}. `children` is injected by `FC`. @public */
export interface ResumableProps {
  /** The scope's registered name — must match the client-side `registerScope`. */
  name: string;
  /** Optional element id on the scope root, so it can serve as a `commandfor` sink. */
  id?: string | undefined;
  /** Serializable initial state, rehydrated into signals on first interaction. */
  state?: Record<string, unknown> | undefined;
  /** Handle the scope's own setup addresses the root by, mapped to `data-ref`. */
  ref?: string | undefined;
  /** Classes for the scope root, which is a real box in its parent's layout. */
  class?: string | undefined;
}

/** Wraps SSR children in a resumable scope, resumed on first interaction with a descendant. @public */
export const Resumable: FC<ResumableProps> = ({ name, id, state, ref, class: cls, children }) => (
  <div data-scope={name} id={id} {...(state ? { [ISLAND_STATE_ATTR]: JSON.stringify(state) } : {})} data-ref={ref} class={cls}>
    {children}
  </div>
);
