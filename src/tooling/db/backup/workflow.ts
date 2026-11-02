import { readRestoreReportValue } from "../../../storage/backup/report";
import { readSidecarValue } from "../../../storage/backup/sidecar";
import type { D1BackupHazard, D1BackupSidecar, D1RestoreReport } from "../../../storage/backup/types";
import { v } from "../../../validation/validation";
import { createCfClient } from "../../cf/api/client";
import { workflowInstancesPath } from "../../cf/api/endpoints";
import { classifyCfError } from "../../cf/api/errors";
import { CF_ENVELOPE, CF_OPERATIONS, CF_WORKFLOW_INSTANCE } from "../../cf/api/operations";
import { readCfAuth } from "../../cf/auth";
import { readDeployment } from "../../cf/config/environment";
import { CliError } from "../../cli/errors";
import { D1_REQUEST_TIMEOUT_MS } from "../remote";
import { isRemotePlace } from "../target";
import type { DbConfig, DbIo, DbRunContext, Home, WorkflowInstanceState, WorkflowRoute } from "../types";
import type { WorkflowPurpose } from "./types";

/** How long the CLI waits between two reads of a running instance. @internal */
export const WORKFLOW_POLL_MS = 2_000;

/** How long the CLI follows an instance before it hands back its id instead. @internal */
export const WORKFLOW_WAIT_MS = 2 * 60 * 60_000;

const FAILED = new Set(["errored", "terminated"]);

function instanceState(instance: v.InferOutput<typeof CF_WORKFLOW_INSTANCE>): WorkflowInstanceState {
  const error = instance.error == null ? null : typeof instance.error === "string" ? instance.error : instance.error.message;
  return { status: instance.status, output: instance.output, error };
}

/** The backup Workflow: `d1-backup` by convention, returning `runD1Backup`'s sidecar. @internal */
export const BACKUP_WORKFLOW: WorkflowPurpose<D1BackupSidecar> = {
  preferred: "d1-backup",
  returns: "runD1Backup's sidecar",
  read: readSidecarValue,
};

/** The restore Workflow: `d1-restore` by convention, returning `runD1Restore`'s report. @internal */
export const RESTORE_WORKFLOW: WorkflowPurpose<D1RestoreReport> = {
  preferred: "d1-restore",
  returns: "runD1Restore's report",
  read: readRestoreReportValue,
};

/** The Workflow a verb starts: the one `--workflow` names, else the one of the conventional name, else the config's only one. @internal */
export function resolveWorkflow(config: DbConfig, named: string | undefined, purpose: WorkflowPurpose<unknown>): string {
  const read = readDeployment(config.config, config.env);
  const declared = read.ok ? read.data.effective.workflows : undefined;
  const own = (declared ?? []).filter((workflow) => workflow.script_name === undefined);
  const where = config.env === null ? config.configPath : `${config.configPath} (env ${config.env})`;
  const names = own.map((workflow) => workflow.name).join(", ");
  if (named !== undefined) {
    const match = own.find((workflow) => workflow.name === named || workflow.binding === named);
    if (match !== undefined) return match.name;
    throw new CliError("invalid-args", `${where} declares no Workflow named ${named} — declared: ${names || "none"}`);
  }
  const conventional = own.find((workflow) => workflow.name === purpose.preferred || workflow.name === `${purpose.preferred}-${config.env}`);
  if (conventional !== undefined) return conventional.name;
  const [only, ...rest] = own;
  if (only === undefined) {
    throw new CliError(
      "invalid-args",
      `${where} declares no Workflow — add ${purpose.preferred}, whose run() returns ${purpose.returns} (src/storage/README.md)`,
    );
  }
  if (rest.length > 0)
    throw new CliError(
      "invalid-args",
      `${where} declares several Workflows and none named ${purpose.preferred} — pass --workflow, one of ${names}`,
    );
  return only.name;
}

/** Starts and reads instances through the Cloudflare API, with the run's account and token. @internal */
export function cloudflareWorkflowRoute(io: DbIo, home: Home): WorkflowRoute {
  const auth = home.auth ?? readCfAuth({});
  const client = createCfClient(auth, io.fetch, D1_REQUEST_TIMEOUT_MS, (ms) => io.sleep(ms));
  const path = (workflow: string) => workflowInstancesPath(auth.accountId, workflow);
  return {
    where: "the Cloudflare API",
    async create(workflow, params) {
      const created = await client.post(path(workflow), { params }, CF_OPERATIONS.createWorkflowInstance);
      if (!created.ok && classifyCfError(created.error) === "network") {
        throw new CliError("external", `${mayHaveStarted(workflow, "")}: ${created.error.message}`, { cause: created.error });
      }
      if (!created.ok)
        throw new CliError("external", `starting the ${workflow} Workflow failed: ${created.error.message}`, { cause: created.error });
      return created.data.id;
    },
    async read(workflow, id) {
      const read = await client.get(`${path(workflow)}/${encodeURIComponent(id)}`, CF_OPERATIONS.getWorkflowInstance);
      if (!read.ok) throw new CliError("external", `reading ${workflow} instance ${id} failed: ${read.error.message}`, { cause: read.error });
      return instanceState(read.data);
    },
  };
}

function mayHaveStarted(workflow: string, local: string): string {
  return `starting the ${workflow} Workflow got no answer, so an instance may have started — check \`wrangler workflows instances list ${workflow}${local}\` before running again, since a second backup blocks the database again`;
}

/** Starts and reads instances through a local dev session's explorer API, the one `wrangler workflows trigger --local` uses. @internal */
export function devSessionWorkflowRoute(io: DbIo, port: number, timeoutMs = D1_REQUEST_TIMEOUT_MS): WorkflowRoute {
  const where = `the dev session on port ${port}`;
  const call = async (workflow: string, suffix: string, init: RequestInit): Promise<unknown> => {
    const url = `http://localhost:${port}/cdn-cgi/local/explorer/api/workflows/${encodeURIComponent(workflow)}/instances${suffix}`;
    const signal = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await io.fetch(url, { ...init, signal });
    } catch {
      if (signal.aborted) {
        if (init.method === "POST") throw new CliError("external", mayHaveStarted(workflow, ` --local --port ${port}`));
        throw new CliError("external", `${where} did not answer within ${timeoutMs / 1000} s`);
      }
      throw new CliError(
        "external",
        `nothing answered on port ${port} — start the app with \`forge cf dev\`, or pass the port it serves on as --port`,
      );
    }
    const envelope = v.safeParse(CF_ENVELOPE, await res.json().catch(() => null));
    if (!envelope.success) throw new CliError("external", `${where} did not answer as wrangler's local explorer API (HTTP ${res.status})`);
    if (!envelope.output.success) {
      throw new CliError("external", `${where} refused: ${envelope.output.errors[0]?.message ?? `HTTP ${res.status}`}`);
    }
    return envelope.output.result;
  };
  return {
    where,
    async create(workflow, params) {
      const body = JSON.stringify({ params });
      const result = v.safeParse(CF_OPERATIONS.createWorkflowInstance.result, await call(workflow, "", { method: "POST", body }));
      if (!result.success) throw new CliError("external", `${where} started ${workflow} without naming the instance`);
      return result.output.id;
    },
    async read(workflow, id) {
      const result = v.safeParse(CF_WORKFLOW_INSTANCE, await call(workflow, `/${encodeURIComponent(id)}`, { method: "GET" }));
      if (!result.success) throw new CliError("external", `${where} answered ${workflow} instance ${id} in a shape it does not document`);
      return instanceState(result.output);
    },
  };
}

/** Starts the app's Workflow for `purpose` with `params`, and follows it to its end, answering the instance and what its run returned. @internal */
export async function followWorkflow<T>(
  run: DbRunContext,
  purpose: WorkflowPurpose<T>,
  options: { readonly workflow: string | undefined; readonly port: number; readonly params: unknown; readonly route?: WorkflowRoute },
): Promise<{ instance: string; output: T }> {
  const workflow = resolveWorkflow(run.config, options.workflow, purpose);
  const route =
    options.route ??
    (isRemotePlace(run.config.target.place) ? cloudflareWorkflowRoute(run.io, run.home) : devSessionWorkflowRoute(run.io, options.port));
  const instance = await route.create(workflow, options.params);
  if (!run.json) run.print(`  started ${workflow} instance ${instance} through ${route.where}`);
  const deadline = run.io.now().getTime() + WORKFLOW_WAIT_MS;
  for (;;) {
    const state = await route.read(workflow, instance);
    if (state.status === "complete") {
      const output = purpose.read(state.output);
      if (output === null)
        throw new CliError("external", `${workflow} instance ${instance} finished without returning ${purpose.returns} from run()`);
      return { instance, output };
    }
    if (FAILED.has(state.status))
      throw new CliError("external", `${workflow} instance ${instance} ${state.status}: ${state.error ?? "no error given"}`);
    if (run.io.now().getTime() >= deadline) {
      throw new CliError(
        "external",
        `${workflow} instance ${instance} is still ${state.status} after ${WORKFLOW_WAIT_MS / 60_000} minutes; it keeps running`,
      );
    }
    await run.io.sleep(WORKFLOW_POLL_MS);
  }
}

function describeHazard(hazard: D1BackupHazard): string {
  const at = hazard.column === null ? hazard.table : `${hazard.table}.${hazard.column}`;
  switch (hazard.kind) {
    case "escape":
      return `${at}: ${hazard.count} text value(s) holding a \\n or \\r escape beside a real newline or carriage return, which D1's dumper doubles`;
    case "integer":
      return `${at}: ${hazard.count} integer(s) past ±2^53, which D1's dumper rounds`;
    case "real":
      return `${at}: ${hazard.count} REAL(s) with no fraction in a column without REAL affinity, which D1's dumper restores as INTEGER`;
    case "unscanned":
      return `${at}: not scanned for hazards, because the scan failed`;
  }
}

/** The lines `forge db backup` prints for a stored dump, its hazards last. @internal */
export function describeSidecar(sidecar: D1BackupSidecar): string[] {
  const rows = Object.entries(sidecar.rows).map(([table, count]) => `${table} ${count}`);
  const lines = [
    `✓ ${sidecar.key}`,
    `  ${sidecar.size} bytes at bookmark ${sidecar.bookmark}, migration head ${sidecar.migrationHead ?? "none"}`,
    `  rows: ${rows.join(", ") || "none"}`,
  ];
  if (sidecar.hazards.length === 0) return lines;
  const timeTravel = sidecar.bookmark.startsWith("local-")
    ? "local D1 keeps no Time Travel, so no exact restore exists"
    : `forge db bookmark restore --bookmark ${sidecar.bookmark} restores them exactly while Time Travel keeps that bookmark`;
  return [...lines, ...sidecar.hazards.map((hazard) => `  ! ${describeHazard(hazard)}`), `  ! the dump will not reproduce these — ${timeTravel}`];
}

/** The lines `forge db restore --from` prints for a restore, each mismatch last. @internal */
export function describeRestore(report: D1RestoreReport): string[] {
  const head = `${report.key} into ${report.name} (${report.databaseId})${report.bookmark === null ? "" : ` at bookmark ${report.bookmark}`}`;
  if (report.mismatches.length === 0) return [`✓ restored ${head}`, "  it holds what the dump's sidecar recorded"];
  return [`✗ restored ${head}, but it differs from the dump's sidecar:`, ...report.mismatches.map((mismatch) => `  ! ${mismatch}`)];
}
