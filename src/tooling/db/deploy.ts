import { CliError } from "../cli/errors";
import { wranglerHistoryTable } from "./config";
import { runMigrate } from "./migrate/apply";
import { readStatusReport } from "./migrate/status";
import { quoteSqlIdentifier } from "./sql";
import { formatTarget } from "./target";
import type { DbRunContext, DeployOptions, DeployOutcome, StatusReport } from "./types";
import { queryRowsIfTable } from "./wrangler";

/** Every reason the deployed database is not one forge can migrate forward safely; empty when it is. @internal */
export function deployRefusals(report: StatusReport, wranglerApplied: readonly string[], wranglerTable: string): string[] {
  const reasons: string[] = [];
  if (report.drift.length > 0) reasons.push(`applied but no longer on disk: ${report.drift.join(", ")}`);
  if (report.checksums.mismatched.length > 0) reasons.push(`edited since it was applied: ${report.checksums.mismatched.join(", ")}`);
  if (report.fingerprint.recorded !== null && !report.fingerprint.matches) {
    reasons.push(
      `schema fingerprint ${report.fingerprint.actual} does not match the certified ${report.fingerprint.recorded} — the schema moved outside the migrations`,
    );
  }
  const forge = new Set(report.rows.filter((row) => row.state !== "pending").map((row) => row.name));
  const unknown = wranglerApplied.map((name) => name.replace(/\.sql$/, "")).filter((name) => !forge.has(name));
  if (unknown.length > 0) {
    reasons.push(
      `${wranglerTable} records ${unknown.join(", ")}, which forge never applied — \`wrangler d1 migrations apply\` ran against this database`,
    );
  }
  return reasons;
}

/** Checks the deployed database, applies its pending migrations with a Time Travel bookmark, then runs `wrangler deploy`. @public */
export async function runDeploy(run: DbRunContext, options: DeployOptions): Promise<DeployOutcome> {
  const { config, home, io } = run;
  const target = formatTarget(config.target);
  // `wrangler deploy` ships the Worker bound to `database_id`, so only the database it binds may be the one checked and migrated.
  if (config.target.place !== "remote") {
    throw new CliError(
      "invalid-args",
      `deploy migrates the database the deployed Worker binds, and --target names ${target} — pass --target remote, or leave --target unset`,
    );
  }
  const say = (line: string) => {
    if (!run.json) run.print(line);
  };

  const report = await readStatusReport(run);
  const wranglerTable = wranglerHistoryTable(config);
  const historySelect = `SELECT name FROM ${quoteSqlIdentifier(wranglerTable)} ORDER BY id`;
  const wranglerApplied = ((await queryRowsIfTable(io, home, historySelect)) ?? []).map((row) => String(row.name ?? ""));
  const refusals = deployRefusals(report, wranglerApplied, wranglerTable);
  if (refusals.length > 0) {
    throw new CliError(
      "invalid-args",
      `${home.database} (${target}) is not safe to migrate forward, so nothing was applied or deployed:\n  ${refusals.join("\n  ")}`,
    );
  }

  const pending = report.rows.filter((row) => row.state === "pending").map((row) => row.name);
  const checked = { target, database: home.database, pending };
  if (options.checkOnly) {
    await runMigrate(run, { dryRun: true, bookmark: true, rehearse: false });
    if (pending.length > 0) {
      throw new CliError(
        "invalid-args",
        `${home.database} (${target}) has ${pending.length} pending migration(s) — deploy applies them before \`wrangler deploy\``,
      );
    }
    return { ...checked, applied: [], deployed: false };
  }

  const migrated = await runMigrate(run, { dryRun: false, bookmark: true, rehearse: false });
  const envFlags = config.env === null ? [] : ["-e", config.env];
  const deployed = io.spawn("wrangler", ["deploy", "-c", config.configPath, ...envFlags], { cwd: config.root });
  if (deployed.stdout.trim() !== "") say(deployed.stdout.trimEnd());
  if (deployed.code !== 0) {
    const undo =
      migrated.bookmark !== undefined && migrated.applied.length > 0
        ? `\n${migrated.applied.length} migration(s) were applied before the deploy failed, so the Worker still running is the previous one. Undo the schema with: ${migrated.bookmark.restoreCommand}`
        : "";
    throw new CliError("external", `wrangler deploy failed (exit ${deployed.code}):\n${deployed.stderr.trim()}${undo}`);
  }
  return { ...checked, applied: migrated.applied, ...(migrated.bookmark === undefined ? {} : { bookmark: migrated.bookmark }), deployed: true };
}
