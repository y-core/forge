import type { CfR2Bucket } from "../../api/types";
import type { R2BucketConfig } from "../../types";
import { dnsName } from "./naming";
import { createProvisionedHandler } from "./provisioned";

const path = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/r2/buckets`;

export const r2Handler = createProvisionedHandler<R2BucketConfig>({
  type: "r2_buckets",
  displayName: "R2 Buckets",
  extract: (config) => config.r2_buckets ?? [],
  list: async (client, accountId) => {
    const res = await client.get<{ buckets: CfR2Bucket[] }>(path(accountId));
    // `buckets` is absent rather than empty on some responses; dereferencing it
    // unguarded turned an unexpected payload into a crash mid-run.
    return res.ok ? { ok: true, data: (res.data?.buckets ?? []).map((b) => ({ name: b.name })) } : res;
  },
  create: async (client, accountId, name) => {
    const res = await client.put<null>(`${path(accountId)}/${encodeURIComponent(name)}`, {});
    return res.ok ? { ok: true, data: { name } } : res;
  },
  naming: dnsName,
  // A bucket has no id, so its name is its identity and there is no id step to take.
  localName: (entry) => entry.bucket_name,
  writeback: (entry, _remote, name) => ({ ...entry, bucket_name: name }),
});
