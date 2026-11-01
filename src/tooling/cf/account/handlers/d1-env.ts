import type { Result } from "../../../../result/types";
import { createCfClient } from "../../api/client";
import { d1Path } from "../../api/endpoints";
import { CF_OPERATIONS } from "../../api/operations";
import type { CfApiClientError, CfD1Database } from "../../api/types";
import { listDeployments } from "../../config/environment";
import type { D1DatabaseConfig, SyncResult, WranglerConfig, WranglerEnvironmentConfig } from "../../types";
import { previewName } from "./naming";
import { failureRows } from "./rows";
import type { ConfigPass, HandlerContext } from "./types";

const TYPE = "d1_databases" as const;

type D1Lister = (ctx: HandlerContext) => Promise<Result<CfD1Database[], CfApiClientError>>;

const listAccountD1: D1Lister = (ctx) => createCfClient(ctx.auth, ctx.fetch).list(d1Path(ctx.auth.accountId), CF_OPERATIONS.listD1Databases);

interface Resolved {
  entry: D1DatabaseConfig;
  rows: SyncResult[];
}

/** One entry's ids against the account: an id resolved by the entry's own `database_name` or `<name>-preview` is written back, anything else is reported. */
function resolveEntry(entry: D1DatabaseConfig, label: string, remote: readonly CfD1Database[], ctx: HandlerContext, checkId = true): Resolved {
  const { dryRun, prefix } = ctx;
  const byId = new Map(remote.map((db) => [db.uuid, db]));
  const byName = new Map(remote.map((db) => [db.name, db]));
  const rows: SyncResult[] = [];
  let resolved = entry;
  const fix = (field: "database_id" | "preview_database_id", id: string, why: string) => {
    rows.push({
      resourceType: TYPE,
      binding: label,
      action: dryRun ? "drift" : "updated",
      remoteId: id,
      detail: `${field} ${why}${dryRun ? " — --commit writes it back" : ""}`,
    });
    if (!dryRun) resolved = { ...resolved, [field]: id };
  };

  const bound = entry.database_id === undefined ? undefined : byId.get(entry.database_id);
  if (checkId && bound !== undefined && entry.database_name !== undefined && bound.name !== entry.database_name) {
    rows.push({
      resourceType: TYPE,
      binding: label,
      action: "drift",
      remoteId: bound.uuid,
      detail: `database_id ${bound.uuid} is ${bound.name}, but database_name says ${entry.database_name} — one of them is wrong, and only you know which`,
    });
  }
  if (checkId && bound === undefined) {
    const named = entry.database_name === undefined ? undefined : byName.get(entry.database_name);
    const was = entry.database_id === undefined ? "is unset" : `${entry.database_id} names no database on this account`;
    if (named !== undefined) fix("database_id", named.uuid, `${was}; ${named.name} is ${named.uuid}`);
    else
      rows.push({
        resourceType: TYPE,
        binding: label,
        action: "unavailable",
        detail: `database_id ${was}, and no database answers to its database_name`,
      });
  }

  if (entry.preview_database_id !== undefined && !byId.has(entry.preview_database_id)) {
    const preview = byName.get(previewName(entry, prefix));
    const was = `${entry.preview_database_id} names no database on this account`;
    if (preview !== undefined) fix("preview_database_id", preview.uuid, `${was}; ${preview.name} is ${preview.uuid}`);
    else rows.push({ resourceType: TYPE, binding: label, action: "drift", detail: `preview_database_id ${was}` });
  }
  return { entry: resolved, rows };
}

/** The pass holding every `env.<name>` block's D1 entries to the top level's bindings and to the account, since wrangler gives an environment no binding it does not restate. @internal */
export function createD1EnvironmentPass(listD1: D1Lister = listAccountD1): ConfigPass {
  return (config, ctx) => reconcileEnvironments(config, ctx, listD1);
}

async function reconcileEnvironments(config: WranglerConfig, ctx: HandlerContext, listD1: D1Lister) {
  const environments = listDeployments(config).slice(1);
  if (environments.length === 0) return { config, results: [] };
  const top = config.d1_databases ?? [];
  const scopedAny = environments.some((environment) => environment.effective.d1_databases !== undefined);
  if (top.length === 0 && !scopedAny) return { config, results: [] };

  const listed = await listD1(ctx);
  if (!listed.ok) return { config, results: failureRows(TYPE, [{ binding: "env.*" }], listed.error, ctx) };

  const results: SyncResult[] = [];
  // The top level's own ids are the D1 handler's; only its preview ids are held here.
  const topEntries = top.map((entry) => {
    const resolved = resolveEntry(entry, entry.binding, listed.data, ctx, false);
    results.push(...resolved.rows);
    return resolved.entry;
  });
  const updated: Record<string, WranglerEnvironmentConfig> = {};
  for (const environment of environments) {
    const name = environment.env ?? "";
    const scoped = environment.effective.d1_databases;
    if (scoped === undefined) {
      if (top.length > 0) {
        results.push({
          resourceType: TYPE,
          binding: `env.${name}`,
          action: "drift",
          detail: `declares no d1_databases, and wrangler gives an environment none it does not restate — \`wrangler --env ${name}\` runs without ${top.map((entry) => entry.binding).join(", ")}`,
        });
      }
      updated[name] = environment.stated;
      continue;
    }
    const declared = new Set(scoped.map((entry) => entry.binding));
    for (const missing of top.filter((entry) => !declared.has(entry.binding))) {
      results.push({
        resourceType: TYPE,
        binding: `env.${name}`,
        action: "drift",
        detail: `has no ${missing.binding} entry, which the top level declares`,
      });
    }
    const entries = scoped.map((entry) => {
      const resolved = resolveEntry(entry, `env.${name}.${entry.binding}`, listed.data, ctx);
      results.push(...resolved.rows);
      return resolved.entry;
    });
    updated[name] = { ...environment.stated, d1_databases: entries };
  }
  return { config: { ...config, ...(top.length === 0 ? {} : { d1_databases: topEntries }), env: updated }, results };
}
