import type { Result } from "../../../../result/types";
import type { CfApiClientError } from "../../api/types";
import type { CfClient } from "../../api/types";
import type { DeploymentTarget } from "../../types";
import type { CfAuth, ResolvedPrefix, ResourceType, WranglerConfig } from "../../types";

export interface HandlerContext {
  auth: CfAuth;
  /** Seed for {@link prefix}, and the deployment's name. */
  scriptName: string;
  prefix: ResolvedPrefix;
  dryRun: boolean;
  /** Secret names this run may regenerate; empty unless `--rotate` named them. */
  readonly rotate: ReadonlySet<string>;
  fetch: typeof globalThis.fetch;
  /** Which deployment surface the config addresses — Pages project or Worker script. */
  readonly target: DeploymentTarget;
}

export interface ReconcileResult<TLocal> {
  entries: TLocal[];
  results: import("../../types").SyncResult[];
  /** Remarks about the resource type as a whole, for things that are not a binding. */
  notes?: string[];
}

export interface ResourceHandler<TLocal = unknown> {
  readonly type: ResourceType;
  readonly displayName: string;
  /** Reconcile even when extract() yields nothing, so the handler can report "looked, found nothing". */
  readonly reportsEmpty?: boolean;
  extract(config: WranglerConfig): TLocal[];
  reconcile(entries: TLocal[], ctx: HandlerContext): Promise<ReconcileResult<TLocal>>;
}

/** What a handler that performs no API call knows about its bindings. */
export type Verification = { kind: "no-remote-object"; reason: string } | { kind: "unverified"; reason: string };

/** What a `.dev.vars` key is, decided by the mutually exclusive markers above it. */
export type DevVarKind = "local" | "secret" | "rotatable";

/** One key read from `.dev.vars`, with the line it came from and what its markers make it. */
export interface DevVar {
  name: string;
  value: string;
  kind: DevVarKind;
  line: number;
}

/** One remote resource, reduced to the two things reconciliation compares it by. */
export interface RemoteResource {
  /** Absent for a resource the API gives no id — an R2 bucket is named and nothing more. */
  id?: string;
  name: string;
}

/** The per-resource part of the provision ladder: everything four handlers do not share. */
export interface ProvisionSpec<TLocal extends { binding: string }> {
  type: ResourceType;
  displayName: string;
  extract(config: WranglerConfig): TLocal[];
  list(client: CfClient, accountId: string): Promise<Result<RemoteResource[], CfApiClientError>>;
  create(client: CfClient, accountId: string, name: string): Promise<Result<RemoteResource, CfApiClientError>>;
  naming(prefix: ResolvedPrefix, binding: string): string;
  /** Absent when the resource has no id, so the id-match step and the stale-id note are skipped. */
  localId?(entry: TLocal): string | undefined;
  /** Absent when a config name never overrides the computed one — a KV title is always recomputed. */
  localName?(entry: TLocal): string | undefined;
  writeback(entry: TLocal, remote: RemoteResource, name: string): TLocal;
}

export interface HandlerBuildOptions {
  /** Path to the wrangler config, as given on the command line. Secrets look for `.dev.vars` beside it. */
  configPath: string;
}

/**
 * Whether every requested name may be rotated.
 *
 * Two distinct refusals, because they need different fixes: a name absent from
 * `.dev.vars` is a typo, and an unmarked name is a credential this tool must not
 * regenerate — a third-party API key overwritten with random bytes is gone.
 */
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
  /**
   * Suppress the upstream message. Required wherever the failed request carried a
   * secret, since Cloudflare's rejection text can quote the payload it rejected.
   */
  redactMessage?: boolean;
}
