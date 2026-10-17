import type { Result } from "../../../../result/types";
import type { CfApiClientError, CfD1Database } from "../../api/types";
import type { CfClient } from "../../api/types";
import type { CfAuth, CfHostConfig, ResolvedPrefix, ResourceType, SyncResult, WranglerConfig } from "../../types";

export interface HandlerContext {
  auth: CfAuth;
  /** Seed for {@link prefix}, and the Worker script every request addresses. */
  scriptName: string;
  prefix: ResolvedPrefix;
  dryRun: boolean;
  /** Secret names this run may regenerate; empty unless `--rotate` named them. */
  readonly rotate: ReadonlySet<string>;
  fetch: typeof globalThis.fetch;
}

export interface ReconcileResult<TLocal> {
  entries: TLocal[];
  results: import("../../types").SyncResult[];
  /** Remarks about the resource type as a whole, for things that are not a binding. */
  notes?: string[];
}

/** A pass over the whole config after a handler's own reconcile, for what lives outside the top-level entries it extracts. */
export type ConfigPass = (config: WranglerConfig, ctx: HandlerContext) => Promise<{ config: WranglerConfig; results: SyncResult[] }>;

export interface ResourceHandler<TLocal = unknown> {
  readonly type: ResourceType;
  readonly displayName: string;
  /** Reconcile even when extract() yields nothing, so the handler can report "looked, found nothing". */
  readonly reportsEmpty?: boolean;
  extract(config: WranglerConfig): TLocal[];
  reconcile(entries: TLocal[], ctx: HandlerContext): Promise<ReconcileResult<TLocal>>;
  readonly reconcileConfig?: ConfigPass;
}

/** What a handler that performs no API call knows about its bindings. */
export type Verification = { kind: "no-remote-object"; reason: string } | { kind: "unverified"; reason: string };

/** What a `.dev.vars` key is, decided by the mutually exclusive markers above it. */
export type DevVarKind = "local" | "secret" | "rotatable" | "ring";

/** One key read from `.dev.vars`, with the line it came from and what its markers make it. */
export interface DevVar {
  name: string;
  value: string;
  kind: DevVarKind;
  line: number;
}

/** One remote resource, reduced to the id and name reconciliation compares it by. */
export interface RemoteResource {
  /** Absent for a resource the API gives no id — an R2 bucket is named and nothing more. */
  id?: string;
  name: string;
}

/** The per-resource part of the provision ladder: everything the handlers do not share. */
export interface ProvisionSpec<TLocal extends { binding: string }> {
  type: ResourceType;
  displayName: string;
  extract(config: WranglerConfig): TLocal[];
  list(client: CfClient, accountId: string, ctx: HandlerContext): Promise<Result<RemoteResource[], CfApiClientError>>;
  create(client: CfClient, accountId: string, name: string, entry: TLocal, ctx: HandlerContext): Promise<Result<RemoteResource, CfApiClientError>>;
  naming(prefix: ResolvedPrefix, binding: string): string;
  /** Absent when the resource has no id, so the id-match step and the stale-id note are skipped. */
  localId?(entry: TLocal): string | undefined;
  /** Absent when a config name never overrides the computed one — a KV title is always recomputed. */
  localName?(entry: TLocal): string | undefined;
  writeback(entry: TLocal, remote: RemoteResource, name: string): TLocal;
  /** What a create would send beyond the name, for the dry run's would-create row. */
  describeCreate?(entry: TLocal): string | undefined;
}

/** The account's D1 databases as one sync run has seen them: listed once, with each database the run creates appended. @internal */
export interface D1Inventory {
  list(): Promise<Result<CfD1Database[], CfApiClientError>>;
  /** Takes the answer to every create the run sends, so a refused one still counts as an attempt. */
  record(created: Result<CfD1Database, CfApiClientError>): void;
  attemptedCreate(): boolean;
}

export interface HandlerBuildOptions {
  /** Path to the wrangler config, as given on the command line. Secrets look for `.dev.vars` beside it. */
  configPath: string;
  /** What `config/cf.ts` declares; each D1 database is created and held to the placement named for its binding. */
  placement?: CfHostConfig | undefined;
}

/** Why a rotation was refused: names absent from `.dev.vars`, and names not marked rotatable. */
export interface RotationRefusal {
  unknown: string[];
  unmarked: string[];
}

export type RotationPlan = Result<string[], RotationRefusal>;

/** How a row identifies the binding it is about. */
export interface RowIdentity {
  binding: string;
  remoteName?: string;
}

export interface FailureRowOptions {
  /** Suppress the upstream message, since Cloudflare's rejection text can quote a secret the request carried. */
  redactMessage?: boolean;
}
