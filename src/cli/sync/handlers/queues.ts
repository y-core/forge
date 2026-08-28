import { createCfClient } from "../api/client";
import type { CfQueue } from "../api/types";
import type { QueueProducerConfig, SyncResult } from "../types";
import { dnsName } from "./naming";
import { staleIdDetail } from "./rows";
import type { ReconcileResult, ResourceHandler } from "./types";

export const queuesHandler: ResourceHandler<QueueProducerConfig> = {
  type: "queues",
  displayName: "Queues",

  extract(config) {
    return config.queues?.producers ?? [];
  },

  async reconcile(entries, ctx): Promise<ReconcileResult<QueueProducerConfig>> {
    if (entries.length === 0) return { entries: [], results: [] };

    const client = createCfClient(ctx.auth, ctx.fetch);
    const listResult = await client.list<CfQueue>(`/accounts/${encodeURIComponent(ctx.auth.accountId)}/queues`);

    const updated: QueueProducerConfig[] = [];
    const results: SyncResult[] = [];

    if (!listResult.ok) {
      for (const entry of entries) {
        results.push({ resourceType: "queues", binding: entry.binding, action: "error", detail: listResult.error.message });
        updated.push(entry);
      }
      return { entries: updated, results };
    }

    const remoteById = new Map(listResult.data.map((q) => [q.queue_id, q]));
    const remoteByName = new Map(listResult.data.map((q) => [q.queue_name, q]));

    for (const entry of entries) {
      const byId = entry.queue_id ? remoteById.get(entry.queue_id) : undefined;
      if (byId) {
        results.push({
          resourceType: "queues",
          binding: entry.binding,
          remoteName: byId.queue_name,
          action: "in-sync",
          local: true,
          remote: true,
          remoteId: byId.queue_id,
        });
        updated.push(entry);
        continue;
      }

      // An explicit `queue` names a remote queue and wins over the computed name.
      const remoteName = entry.queue ?? dnsName(ctx.prefix, entry.binding);
      const stale = staleIdDetail(entry.queue_id);

      const byName = remoteByName.get(remoteName);
      if (byName) {
        results.push({
          resourceType: "queues",
          binding: entry.binding,
          remoteName,
          action: "in-sync",
          local: true,
          remote: true,
          remoteId: byName.queue_id,
          detail: stale,
        });
        updated.push({ ...entry, queue: remoteName, queue_id: byName.queue_id });
        continue;
      }

      if (ctx.dryRun) {
        results.push({
          resourceType: "queues",
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

      const createResult = await client.post<CfQueue>(`/accounts/${encodeURIComponent(ctx.auth.accountId)}/queues`, { queue_name: remoteName });

      if (!createResult.ok) {
        results.push({ resourceType: "queues", binding: entry.binding, remoteName, action: "error", detail: createResult.error.message });
        updated.push(entry);
      } else {
        results.push({
          resourceType: "queues",
          binding: entry.binding,
          remoteName,
          action: "created",
          local: true,
          remote: true,
          remoteId: createResult.data.queue_id,
          detail: stale,
        });
        updated.push({ ...entry, queue: remoteName, queue_id: createResult.data.queue_id });
      }
    }

    return { entries: updated, results };
  },
};
