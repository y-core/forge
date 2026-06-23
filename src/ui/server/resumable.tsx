/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../jsx/types";

/** Props for {@link Resumable}. `children` is injected by `FC`. @public */
export interface ResumableProps {
  /** The scope's registered name — must match the client-side `registerScope`. */
  name: string;
  /** Serializable initial state, rehydrated into signals on first interaction. */
  state?: Record<string, unknown>;
}

/**
 * Wraps SSR children in a resumable scope. No eager hydration: a single delegated
 * listener (see resume.ts) resumes this scope on the first interaction with any
 * descendant carrying a `data-on-<event>` attribute, rebuilding `state` into signals.
 * @public
 */
export const Resumable: FC<ResumableProps> = ({ name, state, children }) => (
  <div data-scope={name} data-state={state ? JSON.stringify(state) : undefined}>
    {children}
  </div>
);
