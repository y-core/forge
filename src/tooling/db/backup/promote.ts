import process from "node:process";

import { readRestoreReportValue } from "../../../storage/backup/report";
import { decodeWranglerSource, validateWranglerConfig } from "../../cf/config/parse";
import type { WranglerConfig } from "../../cf/types";
import { CliError } from "../../cli/errors";
import { applyJsoncEdits } from "../../cli/jsonc-edit";
import { d1Entries } from "../config";
import type { DbRunContext, WorkflowRoute } from "../types";
import type { PromotionPlan, PromotionTarget } from "./types";
import { cloudflareWorkflowRoute, resolveWorkflow, RESTORE_WORKFLOW } from "./workflow";

const D1_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const D1_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Holds a target to D1's id and name grammar, since both land in the config and in a printed command. */
function checkedTarget(target: PromotionTarget, from: string): PromotionTarget {
  if (!D1_ID.test(target.databaseId))
    throw new CliError("invalid-args", `${from} names database id ${JSON.stringify(target.databaseId)}, which is not a D1 id`);
  if (!D1_NAME.test(target.name))
    throw new CliError("invalid-args", `${from} names database ${JSON.stringify(target.name)}, which is not a D1 database name`);
  return target;
}

/** The id of the database a dump key was taken from: `<prefix>/<database id>/<instant>-<bookmark>.sql`. */
function dumpSource(key: string): string | null {
  return key.split("/").at(-2) ?? null;
}

async function reportedTarget(
  run: DbRunContext,
  instance: string,
  workflow: string | undefined,
  route: WorkflowRoute,
): Promise<PromotionTarget & { readonly source: string | null }> {
  const name = resolveWorkflow(run.config, workflow, RESTORE_WORKFLOW);
  const state = await route.read(name, instance);
  if (state.status !== "complete")
    throw new CliError("invalid-args", `${name} instance ${instance} is ${state.status}, so it restored nothing to promote`);
  const report = readRestoreReportValue(state.output);
  if (report === null) throw new CliError("invalid-args", `${name} instance ${instance} returned no runD1Restore report`);
  if (report.mismatches.length > 0) {
    throw new CliError(
      "invalid-args",
      `${report.name} differs from the dump it was restored from, so it is not promoted:\n  ${report.mismatches.join("\n  ")}`,
    );
  }
  return { ...checkedTarget({ databaseId: report.databaseId, name: report.name }, `${name} instance ${instance}`), source: dumpSource(report.key) };
}

/** Everything a promotion checks before it asks: a deployed target, the binding's current database, and the restore it would point at. @internal */
export async function preparePromotion(
  run: DbRunContext,
  options: {
    readonly instance?: string | undefined;
    readonly databaseId?: string | undefined;
    readonly databaseName?: string | undefined;
    readonly workflow?: string | undefined;
    readonly route?: WorkflowRoute;
  },
): Promise<PromotionPlan> {
  const { config } = run;
  if (config.target.place !== "remote") {
    throw new CliError(
      "invalid-args",
      `${config.target.place} has no binding to promote onto — promotion points the deployed app at a restored database`,
    );
  }
  const explicit = options.databaseId !== undefined || options.databaseName !== undefined;
  if (explicit === (options.instance !== undefined)) {
    throw new CliError("invalid-args", "promote takes --instance <restore instance id>, or --database-id and --database-name to swap back");
  }
  let to: PromotionTarget;
  let source: string | null = null;
  if (options.instance !== undefined) {
    const reported = await reportedTarget(run, options.instance, options.workflow, options.route ?? cloudflareWorkflowRoute(run.io, run.home));
    to = { databaseId: reported.databaseId, name: reported.name };
    source = reported.source;
  } else {
    if (options.databaseId === undefined || options.databaseName === undefined) {
      throw new CliError("invalid-args", "--database-id and --database-name go together, naming the database to point the binding at");
    }
    to = checkedTarget({ databaseId: options.databaseId, name: options.databaseName }, "--database-id and --database-name");
  }

  const entries = d1Entries(config.config, config.env);
  const index = entries.findIndex((entry) => entry.binding === config.entry.binding);
  const entry = entries[index];
  if (entry === undefined || entry.database_id === undefined) {
    throw new CliError("invalid-args", `${config.configPath} gives the ${config.entry.binding} binding no database_id to replace`);
  }
  const from: PromotionTarget = { databaseId: entry.database_id, name: entry.database_name ?? config.entry.databaseName };
  if (from.databaseId === to.databaseId)
    throw new CliError("invalid-args", `${config.entry.binding} already points at ${to.name} (${to.databaseId})`);
  if (options.instance !== undefined && source !== from.databaseId) {
    throw new CliError(
      "invalid-args",
      `${to.name} was restored from a dump of database ${source ?? "unknown"}, and ${config.entry.binding} names ${from.name} (${from.databaseId}) — promote a restore of this binding's own database`,
    );
  }
  const path = config.env === null ? ["d1_databases", index] : ["env", config.env, "d1_databases", index];
  return {
    configPath: config.configPath,
    binding: config.entry.binding,
    env: config.env,
    from,
    to,
    edits: [
      { path: [...path, "database_id"], value: to.databaseId },
      { path: [...path, "database_name"], value: to.name },
    ],
  };
}

function reparsedConfig(text: string, origin: string): WranglerConfig {
  try {
    return validateWranglerConfig(decodeWranglerSource(text, origin), origin);
  } catch (thrown) {
    throw new CliError("external", `${origin} would no longer parse after the edit, so it is left as it was: ${(thrown as Error).message}`);
  }
}

/** Rewrites the binding's `database_id` and `database_name`, every other byte of the config kept, once the edited text reads back as `plan.to`. @internal */
export function executePromotion(run: DbRunContext, plan: PromotionPlan): void {
  const edited = applyJsoncEdits(run.io.readText(plan.configPath), [...plan.edits]);
  if (!edited.ok) throw new CliError("external", `${plan.configPath} could not be edited: ${edited.error.message}`);
  const entry = d1Entries(reparsedConfig(edited.data, plan.configPath), plan.env).find((candidate) => candidate.binding === plan.binding);
  if (entry?.database_id !== plan.to.databaseId || entry.database_name !== plan.to.name) {
    throw new CliError(
      "external",
      `the edit to ${plan.configPath} would not point ${plan.binding} at ${plan.to.name} (${plan.to.databaseId}), so it is left as it was`,
    );
  }
  const staged = `${plan.configPath}.${process.pid}.promote`;
  run.io.writeText(staged, edited.data);
  run.io.rename(staged, plan.configPath);
}

/** The lines a promotion prints: what the binding names now, the database kept as the fallback, and the deploy that makes it live. @internal */
export function describePromotion(plan: PromotionPlan): string[] {
  const flags = `--target remote --db ${plan.binding}${plan.env === null ? "" : ` -e ${plan.env}`}`;
  return [
    `✓ ${plan.binding} names ${plan.to.name} (${plan.to.databaseId}) in ${plan.configPath}`,
    `  ${plan.from.name} (${plan.from.databaseId}) is kept as it was — swap back with: forge db promote ${flags} --database-id ${plan.from.databaseId} --database-name ${plan.from.name}`,
    "  the deployed app still reads the old database until you deploy",
  ];
}
