import { createCfClient } from "../api/client";
import type { CfR2Bucket } from "../api/types";
import type { R2BucketConfig, SyncResult } from "../types";
import { dnsName } from "./naming";
import type { ReconcileResult, ResourceHandler } from "./types";

export const r2Handler: ResourceHandler<R2BucketConfig> = {
  type: "r2_buckets",
  displayName: "R2 Buckets",

  extract(config) {
    return config.r2_buckets ?? [];
  },

  async reconcile(entries, ctx): Promise<ReconcileResult<R2BucketConfig>> {
    if (entries.length === 0) return { entries: [], results: [] };

    const client = createCfClient(ctx.auth, ctx.fetch);
    const listResult = await client.get<{ buckets: CfR2Bucket[] }>(`/accounts/${encodeURIComponent(ctx.auth.accountId)}/r2/buckets`);

    const updated: R2BucketConfig[] = [];
    const results: SyncResult[] = [];

    if (!listResult.ok) {
      for (const entry of entries) {
        results.push({ resourceType: "r2_buckets", binding: entry.binding, action: "error", detail: listResult.error.message });
        updated.push(entry);
      }
      return { entries: updated, results };
    }

    // `buckets` is absent rather than empty on some responses; dereferencing it
    // unguarded turned an unexpected payload into a crash mid-run.
    const remoteNames = new Set((listResult.data?.buckets ?? []).map((b) => b.name));

    for (const entry of entries) {
      // A bucket has no id, so its name is its identity — an explicit `bucket_name`
      // is what the config already binds and is never overridden by the prefix rule,
      // which exists to name a bucket that does not yet exist.
      const remoteName = entry.bucket_name ?? dnsName(ctx.prefix, entry.binding);

      if (remoteNames.has(remoteName)) {
        results.push({
          resourceType: "r2_buckets",
          binding: entry.binding,
          remoteName,
          action: "in-sync",
          local: true,
          remote: true,
          remoteId: remoteName,
        });
        updated.push({ ...entry, bucket_name: remoteName });
        continue;
      }

      if (ctx.dryRun) {
        results.push({ resourceType: "r2_buckets", binding: entry.binding, remoteName, action: "would-create", local: true, remote: false });
        updated.push(entry);
        continue;
      }

      const createResult = await client.put<null>(
        `/accounts/${encodeURIComponent(ctx.auth.accountId)}/r2/buckets/${encodeURIComponent(remoteName)}`,
        {},
      );

      if (!createResult.ok) {
        results.push({ resourceType: "r2_buckets", binding: entry.binding, remoteName, action: "error", detail: createResult.error.message });
        updated.push(entry);
      } else {
        results.push({
          resourceType: "r2_buckets",
          binding: entry.binding,
          remoteName,
          action: "created",
          local: true,
          remote: true,
          remoteId: remoteName,
        });
        updated.push({ ...entry, bucket_name: remoteName });
      }
    }

    return { entries: updated, results };
  },
};
