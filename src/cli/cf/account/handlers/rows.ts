import { classifyCfError, describeCfFailure } from "../../api/errors";
import type { CfApiClientError } from "../../api/types";
import { surfaceDetail } from "../../target";
import type { ResourceType, SyncResult } from "../../types";
import type { HandlerContext } from "./types";

/** How a row identifies the binding it is about. */
export interface RowIdentity {
  binding: string;
  remoteName?: string;
}

export interface FailureRowOptions {
  /**
   * Suppress the upstream message. Required wherever the failed request carried a
   * secret, since Cloudflare's rejection text can quote the payload it rejected.
   */
  redactMessage?: boolean;
}

/**
 * The note a row carries when the config named an id that the account does not have.
 *
 * Falling back to a name match is the pragmatic behaviour — the id is usually stale
 * from a deleted resource or another account — but it is never silent: the row says
 * which id failed to resolve, since that is the one fact the config is wrong about.
 */
export function staleIdDetail(localId: string | undefined): string | undefined {
  return localId ? `local id ${localId} not found on this account` : undefined;
}

/**
 * The rows for a lookup that failed before any per-binding work could happen.
 *
 * Shared because the three handlers that do this were drifting: the point is that a
 * missing target and a rejected token land on *different actions*, not merely on
 * different prose, and that is worth stating once.
 */
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
