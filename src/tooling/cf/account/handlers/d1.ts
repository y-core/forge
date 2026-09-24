import type { CfD1Database } from "../../api/types";
import type { D1DatabaseConfig } from "../../types";
import { prefixedName } from "./naming";
import { createProvisionedHandler } from "./provisioned";

const path = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/d1/database`;

export const d1Handler = createProvisionedHandler<D1DatabaseConfig>({
  type: "d1_databases",
  displayName: "D1 Databases",
  extract: (config) => config.d1_databases ?? [],
  list: async (client, accountId) => {
    const res = await client.list<CfD1Database>(path(accountId));
    return res.ok ? { ok: true, data: res.data.map((db) => ({ id: db.uuid, name: db.name })) } : res;
  },
  create: async (client, accountId, name) => {
    const res = await client.post<CfD1Database>(path(accountId), { name });
    return res.ok ? { ok: true, data: { id: res.data.uuid, name: res.data.name } } : res;
  },
  naming: prefixedName,
  localId: (entry) => entry.database_id,
  localName: (entry) => entry.database_name,
  writeback: (entry, remote, name) => ({ ...entry, database_id: remote.id as string, database_name: name }),
});
