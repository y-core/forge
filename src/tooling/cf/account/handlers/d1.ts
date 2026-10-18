import { ok } from "../../../../result/result";
import type { Result } from "../../../../result/types";
import { createCfClient } from "../../api/client";
import { D1_WRITE_PERMISSION } from "../../api/endpoints";
import type { CfApiClientError, CfD1Database } from "../../api/types";
import type { D1DatabaseConfig, D1Placement } from "../../types";
import { createD1EnvironmentPass } from "./d1-env";
import { d1CreateBody, d1Path, describePlacement, reconcileD1Placement } from "./d1-placement";
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

/** The D1 handler, creating each database with the placement `config/cf.ts` declares for its binding. @internal */
export function createD1Handler(placement: Readonly<Record<string, D1Placement>> = {}): ResourceHandler<D1DatabaseConfig> {
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
    create: async (client, accountId, name, entry, ctx) => {
      const res = await client.post<CfD1Database>(d1Path(accountId), d1CreateBody(name, placement[entry.binding]));
      inventoryFor(ctx).record(res);
      return res.ok ? { ok: true, data: { id: res.data.uuid, name: res.data.name } } : res;
    },
    naming: prefixedName,
    localId: (entry) => entry.database_id,
    localName: (entry) => entry.database_name,
    writeback: (entry, remote, name) => ({ ...entry, database_id: remote.id as string, database_name: name }),
    describeCreate: (entry) => describePlacement(placement[entry.binding]),
  });
  return {
    ...provisioned,
    reconcileConfig: createD1EnvironmentPass(
      new Set(
        Object.entries(placement)
          .filter(([, declared]) => declared.preview === true)
          .map(([binding]) => binding),
      ),
      (ctx) => inventoryFor(ctx).list(),
    ),
    async reconcile(entries, ctx) {
      const base = await provisioned.reconcile(entries, ctx);
      const inventory = inventoryFor(ctx);
      const placed = Object.keys(placement).length === 0 ? base : await reconcileD1Placement(base, placement, ctx, inventory);
      if (ctx.dryRun || entries.length === 0 || inventory.attemptedCreate()) return placed;
      return { ...placed, notes: [...(placed.notes ?? []), D1_WRITE_UNVERIFIED] };
    },
  };
}
