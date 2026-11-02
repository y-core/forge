import type { JsonPath } from "../../cli/types";
import type { Primitive } from "../../cli/types";
import type { D1DatabaseConfig, R2BucketConfig, WorkflowConfig, WranglerAssetsConfig, WranglerConfig, WranglerEnvironmentConfig } from "../types";

export type ConfigDiff = { kind: "set"; path: JsonPath; value: Primitive } | { kind: "unsupported"; path: JsonPath; reason: string };

/** A config together with the exact bytes it was parsed from, which write-back splices its offsets against. */
export interface LoadedWranglerConfig {
  path: string;
  source: string;
  config: WranglerConfig;
}

export interface WriteOutcome {
  path: string;
  /** False when the config was already up to date — in which case no write was attempted. */
  written: boolean;
  /** How many values were spliced in. */
  edits: number;
  /** Set only on a `--force` rewrite: what that rewrite destroyed. */
  lost?: { comments: number; unsupported: string[] };
}

/** The deployment keys forge reads, as wrangler resolves them for one deployment. @internal */
export interface WranglerDeployment {
  name?: string;
  account_id?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  main?: string;
  assets?: WranglerAssetsConfig;
  workers_dev?: boolean;
  preview_urls?: boolean;
  route?: unknown;
  routes?: unknown[];
  alias?: unknown;
  build?: unknown;
  rules?: unknown;
  define?: unknown;
  d1_databases?: D1DatabaseConfig[];
  r2_buckets?: R2BucketConfig[];
  workflows?: WorkflowConfig[];
}

export type DeploymentKey = keyof WranglerDeployment;

export type EnvironmentInheritance = "inherited" | "not-inherited" | "suffixed" | "top-level";

/** One deployment: the block as written, the keys wrangler builds from it, and which of those it took from the top level. @internal */
export interface ResolvedDeployment {
  /** Null for the top level. */
  env: string | null;
  /** `""` for the top level, `env.<name>.` otherwise. */
  prefix: string;
  stated: WranglerEnvironmentConfig;
  effective: WranglerDeployment;
  inherited: ReadonlySet<DeploymentKey>;
}
