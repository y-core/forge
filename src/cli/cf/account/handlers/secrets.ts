import { existsSync } from "node:fs";
import { createCfClient } from "../../api/client";
import { pagesProject, workerSecrets } from "../../api/endpoints";
import { describeCfFailure } from "../../api/errors";
import type { CfPagesEnvVar, CfPagesProject, CfWorkerSecret } from "../../api/types";
import type { ResourceType, SyncResult } from "../../types";
import type { DevVarKind } from "./devvars";
import { devVarsPath, readDevVars } from "./devvars";
import { randomSecret } from "./rotate";
import { failureRows } from "./rows";
import type { HandlerContext, ReconcileResult, ResourceHandler } from "./types";

interface SecretEntry {
  name: string;
  value: string;
}

const identities = (entries: SecretEntry[]) => entries.map((e) => ({ binding: e.name, remoteName: e.name }));

/** Every request these handlers make carries a secret, so no upstream text is ever quoted. */
const REDACT = { redactMessage: true } as const;

/**
 * `in-sync` for a secret can only ever mean "a secret of that name is there".
 *
 * Neither surface returns a secret's value — a Worker's secret list carries name and
 * type only, and a Pages `secret_text` entry has no readable `value`. So the row says
 * what it verified rather than implying the values match.
 */
const NAME_ONLY_DETAIL = "name only (value not readable)";

/** What this run intends to send for one secret, decided before any request is made. */
type Plan = { kind: "row"; result: SyncResult } | { kind: "write"; name: string; value: string; existed: boolean; rotated: boolean };

/**
 * The two kinds of secret differ in exactly one place, and it is worth naming rather
 * than branching on a string three times: **whose value ends up on the remote.**
 *
 * A fixed secret is a credential issued elsewhere — the local copy is the only copy,
 * so `--commit` sends it. A rotatable secret is one we generate, so the local value
 * is never sent at all; `--rotate` makes a new one directly on the remote and the
 * two sides are expected to differ from then on.
 */
function planSecret(entry: SecretEntry, kind: DevVarKind, remoteNames: ReadonlySet<string>, ctx: HandlerContext): Plan {
  const type: ResourceType = kind === "rotatable" ? "rotatable_secrets" : "secrets";
  const existed = remoteNames.has(entry.name);
  const row = { resourceType: type, binding: entry.name, remoteName: entry.name, local: true, remote: existed };

  if (kind === "rotatable") {
    // A rotatable secret that is not there yet is rotated *in* by a plain `--commit`:
    // there is no old value to destroy, so nothing needs guarding and requiring
    // `--rotate` here would only be a step that can be forgotten. `--rotate` is what
    // it takes to replace a value that already exists.
    const generate = !existed || ctx.rotate.has(entry.name);
    if (!generate) return { kind: "row", result: { ...row, action: "in-sync", detail: NAME_ONLY_DETAIL } };

    if (ctx.dryRun) return { kind: "row", result: { ...row, action: "would-rotate" } };
    // Never `entry.value`: a development secret must not become the production one.
    return { kind: "write", name: entry.name, value: randomSecret(), existed, rotated: true };
  }

  if (existed) return { kind: "row", result: { ...row, action: "in-sync", detail: NAME_ONLY_DETAIL } };
  if (ctx.dryRun) return { kind: "row", result: { ...row, action: "would-create" } };
  return { kind: "write", name: entry.name, value: entry.value, existed, rotated: false };
}

/** The row for a completed write. A rotated value is stated as rotated, never shown. */
function writeRow(write: Extract<Plan, { kind: "write" }>, type: ResourceType, ok: boolean, detail: string): SyncResult {
  // A generated value replacing nothing is a create; replacing one is a rotation.
  const action = !write.existed ? "created" : write.rotated ? "rotated" : "updated";
  return {
    resourceType: type,
    binding: write.name,
    remoteName: write.name,
    action: ok ? action : "error",
    local: true,
    remote: ok,
    detail: ok && write.rotated ? "a new value was generated and pushed; .dev.vars is unchanged" : detail,
  };
}

/** A remote secret no `.dev.vars` key claims. Never written and never deleted — only named. */
function orphanRows(remoteNames: Iterable<string>, declared: ReadonlySet<string>): SyncResult[] {
  return [...remoteNames]
    .filter((name) => !declared.has(name))
    .map((name) => ({
      resourceType: "secrets" as const,
      binding: name,
      remoteName: name,
      action: "remote-only" as const,
      local: false,
      remote: true,
      detail: "not declared in .dev.vars; --commit never removes it",
    }));
}

/**
 * What to say about a `.dev.vars` that yielded nothing at all.
 *
 * A note rather than a row: there is no binding here, no action and no remote
 * counterpart, and the row this used to be had to invent all three — a fake binding
 * called `(none)` carrying `unavailable`, which everywhere else means a missing
 * remote target. A path is not a secret value, so naming the file we consulted is
 * safe and is the whole point.
 */
function emptyNote(path: string): string {
  return existsSync(path) ? `.dev.vars at ${path} defines no keys.` : `No .dev.vars at ${path}.`;
}

interface SecretsHandlerSpec {
  kind: Extract<DevVarKind, "secret" | "rotatable">;
  type: ResourceType;
  displayName: string;
  /** Only one handler may name the orphans, or a remote secret is reported twice. */
  reportsOrphans: boolean;
}

/**
 * Secrets are discovered from `.dev.vars`, so these handlers must be told where the
 * config is. The argument is required: a default here would be a value that is
 * silently wrong from every directory but one.
 *
 * Invariant: **a secret value never reaches a `SyncResult`, a log line or a
 * terminal.** Rows are built from `entry.name` alone, and failure details come from
 * {@link describeCfFailure} rather than from an upstream message, which can echo a
 * rejected payload.
 */
function createHandler(configPath: string, spec: SecretsHandlerSpec): ResourceHandler<SecretEntry> {
  const path = devVarsPath(configPath);

  return {
    type: spec.type,
    displayName: spec.displayName,
    // Absence of secrets is itself worth reporting — "we never looked" and "there
    // are none" were previously the same empty output. Only the handler that names
    // the orphans needs to run on an empty extract, since only it has something to
    // say when the local side is bare.
    reportsEmpty: spec.reportsOrphans,

    extract() {
      return readDevVars(path)
        .filter((v) => v.kind === spec.kind)
        .map((v) => ({ name: v.name, value: v.value }));
    },

    async reconcile(entries, ctx): Promise<ReconcileResult<SecretEntry>> {
      // Nothing to compare against and nothing to look for: concluded without a
      // request, and therefore without needing credentials to work.
      if (entries.length === 0 && !spec.reportsOrphans) return { entries, results: [] };
      if (entries.length === 0 && !existsSync(path)) return { entries, results: [], notes: [emptyNote(path)] };

      const declared = new Set(readDevVars(path).map((v) => v.name));
      const args = { entries, ctx, spec, declared };
      // Selected per-config, never by a flag.
      const { results } = ctx.target.kind === "pages" ? await reconcilePages(args) : await reconcileWorker(args);

      if (results.length === 0) return { entries, results, notes: [emptyNote(path)] };
      return { entries, results };
    },
  };
}

interface ReconcileArgs {
  entries: SecretEntry[];
  ctx: HandlerContext;
  spec: SecretsHandlerSpec;
  declared: ReadonlySet<string>;
}

async function reconcileWorker({ entries, ctx, spec, declared }: ReconcileArgs): Promise<ReconcileResult<SecretEntry>> {
  const client = createCfClient(ctx.auth, ctx.fetch);
  const path = workerSecrets(ctx.auth.accountId, ctx.target.name);
  const listResult = await client.get<CfWorkerSecret[]>(path);

  if (!listResult.ok) return { entries, results: failureRows(spec.type, identities(entries), listResult.error, ctx, REDACT) };

  const remoteNames = new Set(listResult.data.map((s) => s.name));
  const results: SyncResult[] = [];

  for (const entry of entries) {
    const plan = planSecret(entry, spec.kind, remoteNames, ctx);
    if (plan.kind === "row") {
      results.push(plan.result);
      continue;
    }

    const putResult = await client.put<unknown>(path, { name: plan.name, text: plan.value, type: "secret_text" });
    results.push(writeRow(plan, spec.type, putResult.ok, putResult.ok ? "" : describeCfFailure(putResult.error, ctx.target, REDACT)));
  }

  if (spec.reportsOrphans) results.push(...orphanRows(remoteNames, declared));
  return { entries, results };
}

async function reconcilePages({ entries, ctx, spec, declared }: ReconcileArgs): Promise<ReconcileResult<SecretEntry>> {
  const client = createCfClient(ctx.auth, ctx.fetch);
  const path = pagesProject(ctx.auth.accountId, ctx.target.name);
  const getResult = await client.get<CfPagesProject>(path);

  if (!getResult.ok) return { entries, results: failureRows(spec.type, identities(entries), getResult.error, ctx, REDACT) };

  const production = getResult.data.deployment_configs?.production ?? {};
  const remoteNames = new Set(
    Object.entries(production.env_vars ?? {})
      .filter(([, v]) => v?.type === "secret_text")
      .map(([name]) => name),
  );

  const results: SyncResult[] = [];
  const writes: Extract<Plan, { kind: "write" }>[] = [];

  for (const entry of entries) {
    const plan = planSecret(entry, spec.kind, remoteNames, ctx);
    if (plan.kind === "row") results.push(plan.result);
    else writes.push(plan);
  }

  if (spec.reportsOrphans) results.push(...orphanRows(remoteNames, declared));
  if (writes.length === 0) return { entries, results };

  // One PATCH upserts them all — the call merges, so unmanaged remote variables and
  // every plain_text var are untouched.
  const upsert: Record<string, CfPagesEnvVar> = {};
  for (const write of writes) upsert[write.name] = { type: "secret_text", value: write.value };

  const patchResult = await client.patch<unknown>(path, {
    deployment_configs: {
      production: { env_vars: upsert, ...(production.wrangler_config_hash ? { wrangler_config_hash: production.wrangler_config_hash } : {}) },
    },
  });

  const detail = patchResult.ok ? "" : describeCfFailure(patchResult.error, ctx.target, REDACT);
  for (const write of writes) results.push(writeRow(write, spec.type, patchResult.ok, detail));

  return { entries, results };
}

/** Fixed secrets: the local value is the one that goes remote. */
export function createSecretsHandler(configPath: string): ResourceHandler<SecretEntry> {
  return createHandler(configPath, { kind: "secret", type: "secrets", displayName: "Secrets", reportsOrphans: true });
}

/** Rotatable secrets: the local value never leaves, and `--rotate` makes the remote one. */
export function createRotatableSecretsHandler(configPath: string): ResourceHandler<SecretEntry> {
  return createHandler(configPath, { kind: "rotatable", type: "rotatable_secrets", displayName: "Rotatable Secrets", reportsOrphans: false });
}
