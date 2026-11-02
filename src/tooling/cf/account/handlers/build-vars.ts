import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createCfClient } from "../../api/client";
import { WORKERS_CI_PERMISSION, workerBuildSettings, workerScripts } from "../../api/endpoints";
import { classifyCfError, describeCfFailure } from "../../api/errors";
import { CF_OPERATIONS } from "../../api/operations";
import { surfaceDetail } from "../../target";
import type { SyncResult } from "../../types";
import { failureRows } from "./rows";
import type { HandlerContext, ReconcileResult, ResourceHandler } from "./types";

const VARIABLE = "BUN_VERSION";

const CI = { permission: WORKERS_CI_PERMISSION } as const;

const SCOPES = [
  { key: "production_settings", label: "production" },
  { key: "previews_base_config", label: "previews" },
] as const;

const PATCH_EXISTING_PREVIEWS = "?patch_existing_previews=true";

const EXACT_BUN = /^bun@(\d+\.\d+\.\d+)(?:\+.+)?$/;

type BunPin = { kind: "exact"; version: string } | { kind: "refused"; detail: string };

type BuildScope = (typeof SCOPES)[number];

type RemoteVariable = { value?: string | null | undefined; is_secret: boolean };

type Plan = { kind: "row"; result: SyncResult } | { kind: "write"; scope: BuildScope; existed: boolean };

function readBunPin(path: string): BunPin | null {
  if (!existsSync(path)) return null;

  const invalid: BunPin = { kind: "refused", detail: `${path} is not valid JSON` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return invalid;
  }
  if (typeof parsed !== "object" || parsed === null) return invalid;

  const raw = (parsed as { packageManager?: unknown }).packageManager;
  if (typeof raw !== "string" || !raw.startsWith("bun@")) return null;

  const match = EXACT_BUN.exec(raw);
  if (!match?.[1]) {
    return { kind: "refused", detail: `packageManager "${raw}" is not an exact bun@X.Y.Z — Workers Builds needs one version to install` };
  }
  return { kind: "exact", version: match[1] };
}

function planScope(scope: BuildScope, remote: RemoteVariable | undefined, version: string, dryRun: boolean): Plan {
  const row = { resourceType: "build_vars" as const, binding: VARIABLE, local: true, remote: remote !== undefined };

  if (remote === undefined) {
    if (dryRun) return { kind: "row", result: { ...row, action: "would-create", detail: scope.label } };
    return { kind: "write", scope, existed: false };
  }
  if (remote.is_secret) {
    if (dryRun) return { kind: "row", result: { ...row, action: "drift", detail: `${scope.label} · set as a secret, so its value is unreadable` } };
    return { kind: "write", scope, existed: true };
  }
  if (remote.value === version) return { kind: "row", result: { ...row, action: "in-sync", detail: scope.label } };
  if (dryRun) {
    const detail = `${scope.label} · ${JSON.stringify(remote.value ?? "")} → ${JSON.stringify(version)}`;
    return { kind: "row", result: { ...row, action: "drift", detail } };
  }
  return { kind: "write", scope, existed: true };
}

function writeRow(write: Extract<Plan, { kind: "write" }>, version: string, failure: string | undefined): SyncResult {
  const succeeded = failure === undefined;
  return {
    resourceType: "build_vars",
    binding: VARIABLE,
    action: succeeded ? (write.existed ? "updated" : "created") : "error",
    local: true,
    remote: succeeded || write.existed,
    detail: failure ?? `${write.scope.label} · ${version}`,
  };
}

function unavailableRow(detail: string): SyncResult {
  return { resourceType: "build_vars", binding: VARIABLE, action: "unavailable", local: true, detail: surfaceDetail(detail) };
}

async function reconcileBuildVars(pin: Extract<BunPin, { kind: "exact" }>, ctx: HandlerContext): Promise<SyncResult[]> {
  const client = createCfClient(ctx.auth, ctx.fetch);
  const scripts = await client.get(workerScripts(ctx.auth.accountId), CF_OPERATIONS.listWorkerScripts);
  if (!scripts.ok) return failureRows("build_vars", [{ binding: VARIABLE }], scripts.error, ctx);

  const tag = scripts.data.find((s) => s.id === ctx.scriptName)?.tag;
  if (tag === undefined) return [unavailableRow(`not deployed: ${ctx.scriptName}`)];

  const noBuildConfig = unavailableRow(`no Workers Builds configuration for ${ctx.scriptName}`);
  const settingsPath = workerBuildSettings(ctx.auth.accountId, tag);
  const settings = await client.get(settingsPath, CF_OPERATIONS.getWorkerBuildSettings);
  if (!settings.ok) {
    if (classifyCfError(settings.error) === "not-found") return [noBuildConfig];
    const detail = surfaceDetail(describeCfFailure(settings.error, ctx.scriptName, CI));
    return [{ resourceType: "build_vars", binding: VARIABLE, action: "error", local: true, detail }];
  }

  const scopes = SCOPES.filter((scope) => {
    if (settings.data[scope.key] == null) return false;
    return scope.key === "production_settings" || settings.data.previews_enabled;
  });
  if (scopes.length === 0) return [noBuildConfig];

  const results: SyncResult[] = [];
  for (const scope of scopes) {
    const remote = settings.data[scope.key]?.environment_variables?.[VARIABLE];
    const plan = planScope(scope, remote, pin.version, ctx.dryRun);
    if (plan.kind === "row") {
      results.push(plan.result);
      continue;
    }

    const query = scope.key === "previews_base_config" ? PATCH_EXISTING_PREVIEWS : "";
    const body = { [scope.key]: { environment_variables: { [VARIABLE]: { value: pin.version, is_secret: false } } } };
    const written = await client.patch(`${settingsPath}${query}`, body, CF_OPERATIONS.patchWorkerBuildSettings);
    const failure = written.ok ? undefined : surfaceDetail(describeCfFailure(written.error, ctx.scriptName, CI));
    results.push(writeRow(plan, pin.version, failure));
  }
  return results;
}

/** Creates the handler that sets the Workers Builds `BUN_VERSION` from the `packageManager` of the `package.json` beside the given config. */
export function createBuildVarsHandler(configPath: string): ResourceHandler<BunPin> {
  const path = join(dirname(resolve(configPath)), "package.json");

  return {
    type: "build_vars",
    displayName: "Build Variables",

    extract() {
      const pin = readBunPin(path);
      return pin === null ? [] : [pin];
    },

    async reconcile(entries, ctx): Promise<ReconcileResult<BunPin>> {
      const pin = entries[0];
      if (pin === undefined) return { entries, results: [] };
      if (pin.kind === "refused") {
        return { entries, results: [{ resourceType: "build_vars", binding: VARIABLE, action: "refused", local: true, detail: pin.detail }] };
      }
      return { entries, results: await reconcileBuildVars(pin, ctx) };
    },
  };
}
