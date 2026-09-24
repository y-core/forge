import { createCfClient } from "../../api/client";
import { workerSettings } from "../../api/endpoints";
import type { CfWorkerSettings } from "../../api/types";
import type { RateLimitConfig, SyncResult } from "../../types";
import { failureRows } from "./rows";
import type { HandlerContext, ReconcileResult, ResourceHandler } from "./types";

interface CfRateLimitBinding {
  type: string;
  name: string;
  namespace_id?: string;
  simple?: { limit?: number; period?: number };
}

const describeSimple = (simple?: { limit?: number; period?: number }): string => `${simple?.limit ?? "?"}/${simple?.period ?? "?"}s`;

function matches(local: RateLimitConfig, remote: CfRateLimitBinding): boolean {
  return (
    local.namespace_id === remote.namespace_id && local.simple?.limit === remote.simple?.limit && local.simple?.period === remote.simple?.period
  );
}

function pagesResults(entries: RateLimitConfig[]): SyncResult[] {
  return entries.map((entry) => ({
    resourceType: "ratelimits" as const,
    binding: entry.name,
    action: "unavailable" as const,
    local: true,
    detail: 'not supported — wrangler rejects "ratelimits" in a Pages config, so this binding is inert',
  }));
}

async function reconcileWorkerRateLimits(entries: RateLimitConfig[], ctx: HandlerContext): Promise<ReconcileResult<RateLimitConfig>> {
  const client = createCfClient(ctx.auth, ctx.fetch);
  const getResult = await client.get<CfWorkerSettings>(workerSettings(ctx.auth.accountId, ctx.target.name));

  if (!getResult.ok) {
    const identities = entries.map((entry) => ({ binding: entry.name }));
    return { entries, results: failureRows("ratelimits", identities, getResult.error, ctx) };
  }

  const remote = new Map(((getResult.data.bindings ?? []) as CfRateLimitBinding[]).filter((b) => b.type === "ratelimit").map((b) => [b.name, b]));

  const results: SyncResult[] = entries.map((entry) => {
    const row = { resourceType: "ratelimits" as const, binding: entry.name, local: true };
    const found = remote.get(entry.name);

    if (!found) return { ...row, action: "deploy-pushes", remote: false };

    if (matches(entry, found)) {
      return { ...row, action: "in-sync", remote: true, remoteId: found.namespace_id, detail: describeSimple(entry.simple) };
    }

    return {
      ...row,
      action: "drift",
      remote: true,
      detail: `ns ${found.namespace_id ?? "?"} ${describeSimple(found.simple)} → ns ${entry.namespace_id} ${describeSimple(entry.simple)}`,
    };
  });

  return { entries, results };
}

export const rateLimitsHandler: ResourceHandler<RateLimitConfig> = {
  type: "ratelimits",
  displayName: "Rate Limits",

  extract(config) {
    return config.ratelimits ?? [];
  },

  async reconcile(entries, ctx): Promise<ReconcileResult<RateLimitConfig>> {
    if (entries.length === 0) return { entries, results: [] };
    return ctx.target.kind === "pages" ? { entries, results: pagesResults(entries) } : reconcileWorkerRateLimits(entries, ctx);
  },
};
