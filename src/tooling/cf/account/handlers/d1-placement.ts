import { createCfClient } from "../../api/client";
import type { CfClient, CfD1Database } from "../../api/types";
import type { D1DatabaseConfig, D1Placement, ResolvedPrefix, SyncResult } from "../../types";
import { prefixedName } from "./naming";
import { failureRows } from "./rows";
import type { D1Inventory, HandlerContext, ReconcileResult } from "./types";

const TYPE = "d1_databases" as const;

/** The account's D1 collection path. @internal */
export const d1Path = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/d1/database`;

/** The create body Cloudflare takes for a placement — the one `wrangler d1 create` sends. @internal */
export function d1CreateBody(name: string, placement: D1Placement | undefined): Record<string, string> {
  return {
    name,
    ...(placement?.jurisdiction === undefined ? {} : { jurisdiction: placement.jurisdiction }),
    ...(placement?.location === undefined ? {} : { primary_location_hint: placement.location }),
  };
}

/** The name of an entry's preview database: its `database_name`, else the prefixed name the D1 handler creates under, with `-preview`. @internal */
export function previewName(entry: D1DatabaseConfig, prefix: ResolvedPrefix): string {
  return `${entry.database_name ?? prefixedName(prefix, entry.binding)}-preview`;
}

/** A placement as a would-create row says it, or `undefined` for none. @internal */
export function describePlacement(placement: D1Placement | undefined): string | undefined {
  const parts = [
    placement?.jurisdiction === undefined ? null : `jurisdiction ${placement.jurisdiction}`,
    placement?.location === undefined ? null : `location ${placement.location}`,
    placement?.readReplication === undefined ? null : `read replication ${placement.readReplication}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? undefined : `with ${parts.join(", ")}`;
}

/** Holds each provisioned database to its declared placement: a jurisdiction is refused when it differs, replication drifts until `--commit` sets it, and a declared preview database is provisioned. @internal */
export async function reconcileD1Placement(
  base: ReconcileResult<D1DatabaseConfig>,
  placement: Readonly<Record<string, D1Placement>>,
  ctx: HandlerContext,
  inventory: D1Inventory,
): Promise<ReconcileResult<D1DatabaseConfig>> {
  const client = createCfClient(ctx.auth, ctx.fetch);
  const results: SyncResult[] = [...base.results];
  const entries: D1DatabaseConfig[] = [];
  for (const entry of base.entries) {
    const declared = placement[entry.binding];
    if (declared === undefined) {
      entries.push(entry);
      continue;
    }
    const held = declared.jurisdiction !== undefined || declared.readReplication !== undefined;
    if (held && entry.database_id !== undefined) results.push(...(await holdPlacement(client, entry, entry.database_id, declared, ctx)));
    if (declared.preview !== true) {
      entries.push(entry);
      continue;
    }
    const preview = await provisionPreview(client, entry, declared, ctx, inventory);
    results.push(...preview.rows);
    entries.push(preview.entry);
  }
  return { ...base, entries, results };
}

async function holdPlacement(
  client: CfClient,
  entry: D1DatabaseConfig,
  id: string,
  declared: D1Placement,
  ctx: HandlerContext,
): Promise<SyncResult[]> {
  const remote = await client.get<CfD1Database>(`${d1Path(ctx.auth.accountId)}/${encodeURIComponent(id)}`);
  const row = { resourceType: TYPE, binding: entry.binding, remoteId: id, local: true, remote: true } as const;
  if (!remote.ok) return failureRows(TYPE, [{ binding: entry.binding }], remote.error, ctx);
  const rows: SyncResult[] = [];
  const name = remote.data.name;

  if (declared.jurisdiction !== undefined && remote.data.jurisdiction !== declared.jurisdiction) {
    rows.push({
      ...row,
      remoteName: name,
      action: "refused",
      detail: `jurisdiction is ${remote.data.jurisdiction ?? "unset"}, declared ${declared.jurisdiction} — a jurisdiction is set only when a database is created, so this needs a new database and a data move`,
    });
  }

  const mode = remote.data.read_replication?.mode ?? "disabled";
  if (declared.readReplication !== undefined && mode !== declared.readReplication) {
    if (ctx.dryRun) {
      rows.push({ ...row, remoteName: name, action: "drift", detail: `read replication is ${mode}, declared ${declared.readReplication}` });
    } else {
      const put = await client.put<CfD1Database>(`${d1Path(ctx.auth.accountId)}/${encodeURIComponent(id)}`, {
        read_replication: { mode: declared.readReplication },
      });
      rows.push(
        put.ok
          ? { ...row, remoteName: name, action: "updated", detail: `read replication ${mode} → ${declared.readReplication}` }
          : (failureRows(TYPE, [{ binding: entry.binding, remoteName: name }], put.error, ctx)[0] as SyncResult),
      );
    }
  }
  return rows;
}

async function provisionPreview(
  client: CfClient,
  entry: D1DatabaseConfig,
  declared: D1Placement,
  ctx: HandlerContext,
  inventory: D1Inventory,
): Promise<{ entry: D1DatabaseConfig; rows: SyncResult[] }> {
  const name = previewName(entry, ctx.prefix);
  const binding = `${entry.binding} (preview)`;
  const listed = await inventory.list();
  if (!listed.ok) return { entry, rows: failureRows(TYPE, [{ binding, remoteName: name }], listed.error, ctx) };

  const found = listed.data.find((db) => db.uuid === entry.preview_database_id) ?? listed.data.find((db) => db.name === name);
  const row = { resourceType: TYPE, binding, remoteName: found?.name ?? name, local: true } as const;
  if (found !== undefined && found.uuid === entry.preview_database_id) {
    return { entry, rows: [{ ...row, action: "in-sync", remote: true, remoteId: found.uuid }] };
  }
  if (found !== undefined) {
    const was = entry.preview_database_id === undefined ? "is unset" : `${entry.preview_database_id} names no database on this account`;
    const detail = `preview_database_id ${was}; ${found.name} is ${found.uuid}`;
    if (ctx.dryRun)
      return { entry, rows: [{ ...row, action: "drift", remote: true, remoteId: found.uuid, detail: `${detail} — --commit writes it back` }] };
    return {
      entry: { ...entry, preview_database_id: found.uuid },
      rows: [{ ...row, action: "updated", remote: true, remoteId: found.uuid, detail }],
    };
  }
  if (ctx.dryRun) return { entry, rows: [{ ...row, action: "would-create", remote: false, detail: describePlacement(declared) }] };

  const created = await client.post<CfD1Database>(d1Path(ctx.auth.accountId), d1CreateBody(name, declared));
  inventory.record(created);
  if (!created.ok) return { entry, rows: failureRows(TYPE, [{ binding, remoteName: name }], created.error, ctx) };
  return {
    entry: { ...entry, preview_database_id: created.data.uuid },
    rows: [{ ...row, action: "created", remote: true, remoteId: created.data.uuid }],
  };
}
