import { createCfClient } from "../../api/client";
import { pagesProject, workerSettings } from "../../api/endpoints";
import type { CfPagesProject, CfWorkerSettings } from "../../api/types";
import type { SyncResult } from "../../types";
import { devVarsPath, readDevVars } from "./devvars";
import { failureRows } from "./rows";
import type { HandlerContext, ReconcileResult, ResourceHandler } from "./types";

type VarEntry = {
  name: string;
  value: string;
  /** The same name is defined in `.dev.vars`, which `wrangler dev` reads in preference to `vars`. */
  overridden: boolean;
};

/** A var's binding and its remote name are the same string. */
const identities = (entries: VarEntry[]) => entries.map((e) => ({ binding: e.name, remoteName: e.name }));

const OVERRIDE_NOTE = ".dev.vars overrides locally";

/** Values go in a table cell, so a long one is shortened rather than wrapped. */
function abbreviate(value: string, max = 40): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function compareVars(entries: VarEntry[], remote: Map<string, string>): SyncResult[] {
  return entries.map((entry) => {
    const present = remote.has(entry.name);
    const remoteValue = remote.get(entry.name) ?? "";
    const drifted = present && remoteValue !== entry.value;

    const finding = drifted ? `${JSON.stringify(abbreviate(remoteValue))} → ${JSON.stringify(abbreviate(entry.value))}` : undefined;

    return {
      resourceType: "vars" as const,
      binding: entry.name,
      remoteName: entry.name,
      local: true,
      remote: present,
      action: drifted ? ("drift" as const) : present ? ("in-sync" as const) : ("deploy-pushes" as const),
      detail: [finding, entry.overridden ? OVERRIDE_NOTE : undefined].filter(Boolean).join("; "),
    };
  });
}

function orphanRows(remote: Map<string, string>, declared: ReadonlySet<string>): SyncResult[] {
  return [...remote.keys()]
    .filter((name) => !declared.has(name))
    .map((name) => ({
      resourceType: "vars" as const,
      binding: name,
      remoteName: name,
      action: "remote-only" as const,
      local: false,
      remote: true,
      detail: "not declared in wrangler.jsonc — the next deploy removes it",
    }));
}

function rowsFor(entries: VarEntry[], remote: Map<string, string>): SyncResult[] {
  const declared = new Set(entries.map((e) => e.name));
  return [...compareVars(entries, remote), ...orphanRows(remote, declared)];
}

async function readWorkerVars(entries: VarEntry[], ctx: HandlerContext): Promise<ReconcileResult<VarEntry>> {
  const client = createCfClient(ctx.auth, ctx.fetch);
  const getResult = await client.get<CfWorkerSettings>(workerSettings(ctx.auth.accountId, ctx.target.name));

  if (!getResult.ok) {
    return { entries, results: failureRows("vars", identities(entries), getResult.error, ctx) };
  }

  const remote = new Map((getResult.data.bindings ?? []).filter((b) => b.type === "plain_text").map((b) => [b.name, b.text ?? ""]));
  return { entries, results: rowsFor(entries, remote) };
}

async function readPagesVars(entries: VarEntry[], ctx: HandlerContext): Promise<ReconcileResult<VarEntry>> {
  const client = createCfClient(ctx.auth, ctx.fetch);
  const getResult = await client.get<CfPagesProject>(pagesProject(ctx.auth.accountId, ctx.target.name));

  if (!getResult.ok) {
    return { entries, results: failureRows("vars", identities(entries), getResult.error, ctx) };
  }

  const envVars = getResult.data.deployment_configs?.production?.env_vars ?? {};
  const remote = new Map(
    Object.entries(envVars)
      .filter(([, v]) => v?.type === "plain_text")
      .map(([name, v]) => [name, v?.value ?? ""]),
  );
  return { entries, results: rowsFor(entries, remote) };
}

/** Creates the vars handler, reading development overrides from the `.dev.vars` beside the given config. */
export function createVarsHandler(configPath: string): ResourceHandler<VarEntry> {
  const path = devVarsPath(configPath);

  return {
    type: "vars",
    displayName: "Environment Variables",
    reportsEmpty: true,

    extract(config) {
      const overrides = new Set(readDevVars(path).map((v) => v.name));
      return Object.entries(config.vars ?? {}).map(([name, value]) => ({ name, value: String(value), overridden: overrides.has(name) }));
    },

    async reconcile(entries, ctx): Promise<ReconcileResult<VarEntry>> {
      return ctx.target.kind === "pages" ? readPagesVars(entries, ctx) : readWorkerVars(entries, ctx);
    },
  };
}
