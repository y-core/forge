import { createCfClient } from "../api/client";
import type { CfD1Database } from "../api/types";
import type { D1DatabaseConfig, SyncResult } from "../types";
import { prefixedName } from "./naming";
import { staleIdDetail } from "./rows";
import type { ReconcileResult, ResourceHandler } from "./types";

export const d1Handler: ResourceHandler<D1DatabaseConfig> = {
  type: "d1_databases",
  displayName: "D1 Databases",

  extract(config) {
    return config.d1_databases ?? [];
  },

  async reconcile(entries, ctx): Promise<ReconcileResult<D1DatabaseConfig>> {
    if (entries.length === 0) return { entries: [], results: [] };

    const client = createCfClient(ctx.auth, ctx.fetch);
    const listResult = await client.list<CfD1Database>(`/accounts/${encodeURIComponent(ctx.auth.accountId)}/d1/database`);

    const updated: D1DatabaseConfig[] = [];
    const results: SyncResult[] = [];

    if (!listResult.ok) {
      for (const entry of entries) {
        results.push({ resourceType: "d1_databases", binding: entry.binding, action: "error", detail: listResult.error.message });
        updated.push(entry);
      }
      return { entries: updated, results };
    }

    const remoteById = new Map(listResult.data.map((db) => [db.uuid, db]));
    const remoteByName = new Map(listResult.data.map((db) => [db.name, db]));

    for (const entry of entries) {
      // Identity first: a database found by uuid exists, whatever it is named, and the
      // config is left exactly as it is — including a `database_name` that differs from
      // what this run's prefix would have produced.
      const byId = entry.database_id ? remoteById.get(entry.database_id) : undefined;
      if (byId) {
        results.push({
          resourceType: "d1_databases",
          binding: entry.binding,
          remoteName: byId.name,
          action: "in-sync",
          local: true,
          remote: true,
          remoteId: byId.uuid,
        });
        updated.push(entry);
        continue;
      }

      // An explicit `database_name` is the user naming a remote database, so it wins
      // over the computed one; the prefix rule is for naming what does not yet exist.
      const remoteName = entry.database_name ?? prefixedName(ctx.prefix, entry.binding);
      const stale = staleIdDetail(entry.database_id);

      const byName = remoteByName.get(remoteName);
      if (byName) {
        results.push({
          resourceType: "d1_databases",
          binding: entry.binding,
          remoteName,
          action: "in-sync",
          local: true,
          remote: true,
          remoteId: byName.uuid,
          detail: stale,
        });
        updated.push({ ...entry, database_id: byName.uuid, database_name: remoteName });
        continue;
      }

      if (ctx.dryRun) {
        results.push({
          resourceType: "d1_databases",
          binding: entry.binding,
          remoteName,
          action: "would-create",
          local: true,
          remote: false,
          detail: stale,
        });
        updated.push(entry);
        continue;
      }

      const createResult = await client.post<CfD1Database>(`/accounts/${encodeURIComponent(ctx.auth.accountId)}/d1/database`, { name: remoteName });

      if (!createResult.ok) {
        results.push({ resourceType: "d1_databases", binding: entry.binding, remoteName, action: "error", detail: createResult.error.message });
        updated.push(entry);
      } else {
        results.push({
          resourceType: "d1_databases",
          binding: entry.binding,
          remoteName,
          action: "created",
          local: true,
          remote: true,
          remoteId: createResult.data.uuid,
          detail: stale,
        });
        updated.push({ ...entry, database_id: createResult.data.uuid, database_name: remoteName });
      }
    }

    return { entries: updated, results };
  },
};
