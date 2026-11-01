import { CF_OPERATIONS } from "../../api/operations";
import type { R2BucketConfig } from "../../types";
import { dnsName } from "./naming";
import { createProvisionedHandler } from "./provisioned";

const path = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/r2/buckets`;

export const r2Handler = createProvisionedHandler<R2BucketConfig>({
  type: "r2_buckets",
  displayName: "R2 Buckets",
  extract: (config) => config.r2_buckets ?? [],
  list: async (client, accountId) => {
    const res = await client.list(path(accountId), CF_OPERATIONS.listR2Buckets);
    return res.ok ? { ok: true, data: res.data.map((b) => ({ name: b.name })) } : res;
  },
  create: async (client, accountId, name) => {
    const res = await client.put(`${path(accountId)}/${encodeURIComponent(name)}`, {}, CF_OPERATIONS.createR2Bucket);
    return res.ok ? { ok: true, data: { name } } : res;
  },
  naming: dnsName,
  localName: (entry) => entry.bucket_name,
  writeback: (entry, _remote, name) => ({ ...entry, bucket_name: name }),
});
