import { createCfClient } from "../api/client";
import type { CfKvNamespace } from "../api/types";
import type { KvNamespaceConfig, SyncResult } from "../types";
import { prefixedName } from "./naming";
import { staleIdDetail } from "./rows";
import type { ReconcileResult, ResourceHandler } from "./types";

export const kvHandler: ResourceHandler<KvNamespaceConfig> = {
  type: "kv_namespaces",
  displayName: "KV Namespaces",

  extract(config) {
    return config.kv_namespaces ?? [];
  },

  async reconcile(entries, ctx): Promise<ReconcileResult<KvNamespaceConfig>> {
    if (entries.length === 0) return { entries: [], results: [] };

    const client = createCfClient(ctx.auth, ctx.fetch);
    const listResult = await client.list<CfKvNamespace>(`/accounts/${encodeURIComponent(ctx.auth.accountId)}/storage/kv/namespaces`);

    const updated: KvNamespaceConfig[] = [];
    const results: SyncResult[] = [];

    if (!listResult.ok) {
      for (const entry of entries) {
        results.push({ resourceType: "kv_namespaces", binding: entry.binding, action: "error", detail: listResult.error.message });
        updated.push(entry);
      }
      return { entries: updated, results };
    }

    const remoteById = new Map(listResult.data.map((ns) => [ns.id, ns]));
    const remoteByTitle = new Map(listResult.data.map((ns) => [ns.title, ns]));

    for (const entry of entries) {
      // The id is the identity. A namespace found by id already exists whatever it is
      // called, so nothing is created and nothing is written back — the title this run
      // would have computed is not a reason to provision a second namespace.
      const byId = entry.id ? remoteById.get(entry.id) : undefined;
      if (byId) {
        results.push({
          resourceType: "kv_namespaces",
          binding: entry.binding,
          remoteName: byId.title,
          action: "in-sync",
          remoteId: byId.id,
          local: true,
          remote: true,
        });
        updated.push(entry);
        continue;
      }

      const remoteName = prefixedName(ctx.prefix, entry.binding);
      const stale = staleIdDetail(entry.id);

      const byTitle = remoteByTitle.get(remoteName);
      if (byTitle) {
        results.push({
          resourceType: "kv_namespaces",
          binding: entry.binding,
          remoteName,
          action: "in-sync",
          remoteId: byTitle.id,
          local: true,
          remote: true,
          detail: stale,
        });
        updated.push({ ...entry, id: byTitle.id });
        continue;
      }

      if (ctx.dryRun) {
        results.push({
          resourceType: "kv_namespaces",
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

      const createResult = await client.post<CfKvNamespace>(`/accounts/${encodeURIComponent(ctx.auth.accountId)}/storage/kv/namespaces`, {
        title: remoteName,
      });

      if (!createResult.ok) {
        results.push({ resourceType: "kv_namespaces", binding: entry.binding, remoteName, action: "error", detail: createResult.error.message });
        updated.push(entry);
      } else {
        results.push({
          resourceType: "kv_namespaces",
          binding: entry.binding,
          remoteName,
          action: "created",
          remoteId: createResult.data.id,
          local: true,
          remote: true,
          detail: stale,
        });
        updated.push({ ...entry, id: createResult.data.id });
      }
    }

    return { entries: updated, results };
  },
};
