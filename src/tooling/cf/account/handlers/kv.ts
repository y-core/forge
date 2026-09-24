import type { CfKvNamespace } from "../../api/types";
import type { KvNamespaceConfig } from "../../types";
import { prefixedName } from "./naming";
import { createProvisionedHandler } from "./provisioned";

const path = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces`;

export const kvHandler = createProvisionedHandler<KvNamespaceConfig>({
  type: "kv_namespaces",
  displayName: "KV Namespaces",
  extract: (config) => config.kv_namespaces ?? [],
  list: async (client, accountId) => {
    const res = await client.list<CfKvNamespace>(path(accountId));
    return res.ok ? { ok: true, data: res.data.map((ns) => ({ id: ns.id, name: ns.title })) } : res;
  },
  create: async (client, accountId, name) => {
    const res = await client.post<CfKvNamespace>(path(accountId), { title: name });
    return res.ok ? { ok: true, data: { id: res.data.id, name: res.data.title } } : res;
  },
  naming: prefixedName,
  localId: (entry) => entry.id,
  writeback: (entry, remote) => ({ ...entry, id: remote.id as string }),
});
