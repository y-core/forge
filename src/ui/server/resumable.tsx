/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC } from "../../jsx/types";
import { ISLAND_STATE_ATTR } from "../contracts/island-contract";
import type { ResumableProps } from "./types";

/** Wraps SSR children in a resumable scope, resumed on first interaction with a descendant. @public */
export const Resumable: FC<ResumableProps> = ({ name, id, state, ref, class: cls, children }) => (
  <div data-scope={name} id={id} {...(state ? { [ISLAND_STATE_ATTR]: JSON.stringify(state) } : {})} data-ref={ref} class={cls}>
    {children}
  </div>
);
