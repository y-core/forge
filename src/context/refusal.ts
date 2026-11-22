import { contextVar } from "./accessor";
import type { RefuseHook } from "./types";

/** The refusal hook the chain declared, published for every guard on the request that has none of its own. @public */
// oxlint-disable-next-line typescript/no-explicit-any -- the chain's bindings are not known to the guard reading the hook
export const refuseHookCtx = contextVar<RefuseHook<any>>("refuseHook");
