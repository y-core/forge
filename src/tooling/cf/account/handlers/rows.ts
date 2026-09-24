import { classifyCfError, describeCfFailure } from "../../api/errors";
import type { CfApiClientError } from "../../api/types";
import { surfaceDetail } from "../../target";
import type { ResourceType, SyncResult } from "../../types";
import type { HandlerContext } from "./types";
import type { FailureRowOptions, RowIdentity } from "./types";

/** The note a row carries when the config named an id that the account does not have. */
export function staleIdDetail(localId: string | undefined): string | undefined {
  return localId ? `local id ${localId} not found on this account` : undefined;
}

/** The rows for a lookup that failed before any per-binding work could happen. */
export function failureRows(
  resourceType: ResourceType,
  identities: RowIdentity[],
  error: CfApiClientError,
  ctx: HandlerContext,
  options: FailureRowOptions = {},
): SyncResult[] {
  const action = classifyCfError(error) === "not-found" ? ("unavailable" as const) : ("error" as const);
  const detail = surfaceDetail(ctx.target, describeCfFailure(error, ctx.target, options));
  return identities.map(({ binding, remoteName }) => ({ resourceType, binding, remoteName, action, detail }));
}
