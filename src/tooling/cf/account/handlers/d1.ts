import { ok } from "../../../../result/result";
import type { Result } from "../../../../result/types";
import { createCfClient } from "../../api/client";
import { D1_WRITE_PERMISSION, d1Path } from "../../api/endpoints";
import type { CfApiClientError, CfD1Database } from "../../api/types";
import type { D1DatabaseConfig } from "../../types";
import { createD1EnvironmentPass } from "./d1-env";
import { prefixedName } from "./naming";
import { createProvisionedHandler } from "./provisioned";
import type { D1Inventory, HandlerContext, ResourceHandler } from "./types";

const D1_WRITE_UNVERIFIED = `D1 write access is unverified — a token without ${D1_WRITE_PERMISSION} fails the first forge db migrate --target remote`;

function createD1Inventory(ctx: HandlerContext): D1Inventory {
  let listing: Promise<Result<CfD1Database[], CfApiClientError>> | undefined;
  let attempted = false;
  return {
    list: () => (listing ??= createCfClient(ctx.auth, ctx.fetch).list<CfD1Database>(d1Path(ctx.auth.accountId))),
    record(created) {
      attempted = true;
      if (!created.ok || listing === undefined) return;
      listing = listing.then((listed) => (listed.ok ? ok([...listed.data, created.data]) : listed));
    },
    attemptedCreate: () => attempted,
  };
}

/** The D1 handler, sharing one account listing across its reconcile and its environment pass. @internal */
export function createD1Handler(): ResourceHandler<D1DatabaseConfig> {
  const inventories = new WeakMap<HandlerContext, D1Inventory>();
  const inventoryFor = (ctx: HandlerContext): D1Inventory => {
    const known = inventories.get(ctx);
    if (known !== undefined) return known;
    const fresh = createD1Inventory(ctx);
    inventories.set(ctx, fresh);
    return fresh;
  };
  const provisioned = createProvisionedHandler<D1DatabaseConfig>({
    type: "d1_databases",
    displayName: "D1 Databases",
    extract: (config) => config.d1_databases ?? [],
    list: async (_client, _accountId, ctx) => {
      const res = await inventoryFor(ctx).list();
      return res.ok ? { ok: true, data: res.data.map((db) => ({ id: db.uuid, name: db.name })) } : res;
    },
    create: async (client, accountId, name, ctx) => {
      const res = await client.post<CfD1Database>(d1Path(accountId), { name });
      inventoryFor(ctx).record(res);
      return res.ok ? { ok: true, data: { id: res.data.uuid, name: res.data.name } } : res;
    },
    naming: prefixedName,
    localId: (entry) => entry.database_id,
    localName: (entry) => entry.database_name,
    writeback: (entry, remote, name) => ({ ...entry, database_id: remote.id as string, database_name: name }),
  });
  return {
    ...provisioned,
    reconcileConfig: createD1EnvironmentPass((ctx) => inventoryFor(ctx).list()),
    async reconcile(entries, ctx) {
      const base = await provisioned.reconcile(entries, ctx);
      if (ctx.dryRun || entries.length === 0 || inventoryFor(ctx).attemptedCreate()) return base;
      return { ...base, notes: [...(base.notes ?? []), D1_WRITE_UNVERIFIED] };
    },
  };
}
