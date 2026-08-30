import type { DeploymentTarget } from "../../target";
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
