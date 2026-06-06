/** @jsxImportSource @y-core/forge */

import type { JSXNode } from "../../jsx/types";

/**
 * Wraps SSR children in a resumable scope. No eager hydration: a single delegated
 * listener (see resume.ts) resumes this scope on the first interaction with any
 * descendant carrying a `data-on-<event>` attribute, rebuilding `state` into signals.
 *
 * @param name  The scope's registered name — must match the client-side `registerScope`.
 * @param state Serializable initial state, rehydrated into signals on first interaction.
 * @param children SSR content, including elements marked with `data-on-<event>` actions.
 * @public
 */
export function Resumable({ name, state, children }: { name: string; state?: Record<string, unknown>; children?: JSXNode }): JSXNode {
  return (
    <div data-scope={name} data-state={state ? JSON.stringify(state) : undefined}>
      {children}
    </div>
  );
}
