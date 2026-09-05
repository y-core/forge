import type { Result } from "../../../../result/result";
import type { CfClient } from "../../api/client";
import { createCfClient } from "../../api/client";
import type { CfApiClientError } from "../../api/types";
import type { ResolvedPrefix, ResourceType, SyncResult, WranglerConfig } from "../../types";
import { failureRows, staleIdDetail } from "./rows";
import type { ReconcileResult, ResourceHandler } from "./types";

/** One remote resource, reduced to the two things reconciliation compares it by. */
export interface RemoteResource {
  /** Absent for a resource the API gives no id — an R2 bucket is named and nothing more. */
  id?: string;
  name: string;
}

/** The per-resource part of the provision ladder: everything four handlers do not share. */
export interface ProvisionSpec<TLocal extends { binding: string }> {
  type: ResourceType;
  displayName: string;
  extract(config: WranglerConfig): TLocal[];
  list(client: CfClient, accountId: string): Promise<Result<RemoteResource[], CfApiClientError>>;
  create(client: CfClient, accountId: string, name: string): Promise<Result<RemoteResource, CfApiClientError>>;
  naming(prefix: ResolvedPrefix, binding: string): string;
  /** Absent when the resource has no id, so the id-match step and the stale-id note are skipped. */
  localId?(entry: TLocal): string | undefined;
  /** Absent when a config name never overrides the computed one — a KV title is always recomputed. */
  localName?(entry: TLocal): string | undefined;
  writeback(entry: TLocal, remote: RemoteResource, name: string): TLocal;
}

/**
 * Factory for the bindings this tool provisions — D1, KV, Queues, R2.
 *
 * All four walk the same ladder: list, match by id, match by name, create, write back.
 * They differ only in the field names and the two endpoints, so the ladder is written
 * once and the differences are a spec — which is also what keeps a fix to one of them
 * from being a fix to only one of them.
 */
export function createProvisionedHandler<TLocal extends { binding: string }>(spec: ProvisionSpec<TLocal>): ResourceHandler<TLocal> {
  return {
    type: spec.type,
    displayName: spec.displayName,
    extract: (config) => spec.extract(config),

    async reconcile(entries, ctx): Promise<ReconcileResult<TLocal>> {
      if (entries.length === 0) return { entries: [], results: [] };

      const client = createCfClient(ctx.auth, ctx.fetch);
      const listResult = await spec.list(client, ctx.auth.accountId);

      const updated: TLocal[] = [];
      const results: SyncResult[] = [];

      if (!listResult.ok) {
        const identities = entries.map((entry) => ({ binding: entry.binding }));
        return { entries: [...entries], results: failureRows(spec.type, identities, listResult.error, ctx) };
      }

      const remoteById = new Map(listResult.data.filter((r) => r.id !== undefined).map((r) => [r.id as string, r]));
      const remoteByName = new Map(listResult.data.map((r) => [r.name, r]));

      for (const entry of entries) {
        const row = { resourceType: spec.type, binding: entry.binding, local: true };

        // Identity first: a resource found by id already exists whatever it is called, so
        // the name this run would compute is not a reason to provision a second copy.
        const localId = spec.localId?.(entry);
        const byId = localId ? remoteById.get(localId) : undefined;
        if (byId) {
          results.push({ ...row, remoteName: byId.name, action: "in-sync", remote: true, remoteId: byId.id });
          updated.push(entry);
          continue;
        }

        // An explicit name in the config is the user naming a remote resource, so it wins
        // over the computed one; the prefix rule is for naming what does not yet exist.
        const remoteName = spec.localName?.(entry) ?? spec.naming(ctx.prefix, entry.binding);
        const stale = staleIdDetail(localId);

        const byName = remoteByName.get(remoteName);
        if (byName) {
          results.push({ ...row, remoteName, action: "in-sync", remote: true, remoteId: byName.id ?? byName.name, detail: stale });
          updated.push(spec.writeback(entry, byName, remoteName));
          continue;
        }

        if (ctx.dryRun) {
          results.push({ ...row, remoteName, action: "would-create", remote: false, detail: stale });
          updated.push(entry);
          continue;
        }

        const createResult = await spec.create(client, ctx.auth.accountId, remoteName);
        if (!createResult.ok) {
          results.push(...failureRows(spec.type, [{ binding: entry.binding, remoteName }], createResult.error, ctx));
          updated.push(entry);
          continue;
        }

        const created = createResult.data;
        results.push({ ...row, remoteName, action: "created", remote: true, remoteId: created.id ?? remoteName, detail: stale });
        updated.push(spec.writeback(entry, created, remoteName));
      }

      return { entries: updated, results };
    },
  };
}
