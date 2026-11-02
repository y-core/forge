import { join } from "node:path";

import { CliError } from "../../cli/errors";
import { sharedD1Databases } from "../config";
import { persistRoot } from "../home";
import { classifyTable } from "../sql";
import { isRemotePlace } from "../target";
import type { DbRunContext } from "../types";
import { compareRowCounts, liveRowCounts, readLocalDump, resolveDumpSource } from "./dumps";
import type { ResetOptions, ResetOutcome, ResetPlan } from "./types";

/** How old a dump may be for a reset to rely on it. @internal */
export const RESET_DUMP_MAX_AGE_MS = 24 * 60 * 60_000;

/** Everything a reset checks before it asks: the target, the state directory, its rows, and the R2 dump that proves them recoverable. @public */
export async function prepareReset(run: DbRunContext, options: ResetOptions): Promise<ResetPlan> {
  const { io, home, config } = run;
  if (isRemotePlace(config.target.place)) {
    throw new CliError(
      "invalid-args",
      `${config.target.place} cannot be reset from here — return a deployed database to a point in time with \`forge db bookmark restore\`, or replace it with \`wrangler d1 create\``,
    );
  }

  // Every environment's local database shares one state directory, and the miniflare filename is a
  // hash, so one of several cannot be told from another; refusing beats guessing which to remove.
  const declared = sharedD1Databases(config.config);
  if (config.target.place === "local" && declared.length > 1) {
    throw new CliError(
      "invalid-args",
      `${config.configPath} declares ${declared.length} d1 databases across its environments (${declared.join(", ")}) and the miniflare state filename is a hash — this tool cannot reset one of several`,
    );
  }

  if (options.expect !== home.database) {
    throw new CliError("invalid-args", `--expect ${options.expect} does not name this target, which is ${home.database}`);
  }

  const state = join(persistRoot(home), "d1", "miniflare-D1DatabaseObject");
  if (!io.exists(state)) return { database: home.database, state: null, rows: 0, backedUpBy: null };

  const counts = await liveRowCounts(run, home);
  const rows = [...counts].filter(([name]) => classifyTable(name) === "app").reduce((total, [, count]) => total + count, 0);

  let backedUpBy: string | null = null;
  if (rows > 0 && !options.allowUnbacked) {
    const unbacked = "Run `forge db backup` first, or pass --allow-unbacked if this database is genuinely disposable";
    const source = resolveDumpSource(run, { bucket: options.bucket, prefix: options.prefix });
    const sidecar = await readLocalDump(run, source, options.dump).catch((error: unknown) => {
      throw error instanceof CliError ? new CliError("invalid-args", `${home.database} holds ${rows} rows and ${error.message}`) : error;
    });
    const age = io.now().getTime() - Date.parse(sidecar.takenAt);
    const stale = compareRowCounts(sidecar, counts);
    if (!Number.isFinite(age) || age < 0) stale.unshift(`its takenAt ${JSON.stringify(sidecar.takenAt)} is not an instant in the past`);
    else if (age > RESET_DUMP_MAX_AGE_MS)
      stale.unshift(`it was taken ${sidecar.takenAt}, more than ${RESET_DUMP_MAX_AGE_MS / 3_600_000} hours ago`);
    if (stale.length > 0) {
      throw new CliError(
        "invalid-args",
        `${sidecar.key} no longer describes ${home.database}, so it does not prove these ${rows} rows are recoverable:\n  ${stale.join("\n  ")}\n${unbacked}`,
      );
    }
    backedUpBy = sidecar.key;
  }

  return { database: home.database, state, rows, backedUpBy };
}

/** Removes the state directory a prepared reset named, if any, and reports. @public */
export async function executeReset(run: DbRunContext, plan: ResetPlan): Promise<ResetOutcome> {
  // The handle over this state is released before the directory holding it is removed.
  if (plan.state !== null) {
    await run.io.closeD1(run.home);
    run.io.remove(plan.state);
  }
  return { database: plan.database, rows: plan.rows, removed: plan.state, backedUpBy: plan.backedUpBy };
}
