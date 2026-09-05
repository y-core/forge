// Cloudflare v4 API response envelope
export interface CfApiResponse<T> {
  result: T;
  success: boolean;
  errors: CfApiError[];
  messages: unknown[];
  result_info?: CfResultInfo;
}

export interface CfApiError {
  code: number;
  message: string;
}

export interface CfResultInfo {
  page: number;
  per_page: number;
  count: number;
  total_count: number;
}

// KV Namespace
export interface CfKvNamespace {
  id: string;
  title: string;
  supports_url_encoding?: boolean;
}

// D1 Database
export interface CfD1Database {
  uuid: string;
  name: string;
  created_at?: string;
  version?: string;
}

// R2 Bucket
export interface CfR2Bucket {
  name: string;
  creation_date?: string;
}

// Queue
export interface CfQueue {
  queue_id: string;
  queue_name: string;
  created_on?: string;
  modified_on?: string;
}

// Worker settings (for vars)
export interface CfWorkerSettings {
  bindings?: CfWorkerBinding[];
  logpush?: boolean;
}

export interface CfWorkerBinding {
  type: string;
  name: string;
  text?: string;
}

// Worker secret
export interface CfWorkerSecret {
  name: string;
  type: string;
}

// `env_vars` is an object keyed by variable name, not an array; a `secret_text` entry
// carries no readable `value` — see api/endpoints.ts.
export interface CfPagesEnvVar {
  type: "plain_text" | "secret_text";
  value?: string;
}

export interface CfPagesDeploymentConfig {
  /** A `null` value deletes that variable; PATCH merges rather than replaces. */
  env_vars?: Record<string, CfPagesEnvVar | null>;
  /** Echoed back on PATCH, as wrangler does on every one of these calls. */
  wrangler_config_hash?: string;
}

export interface CfPagesDeploymentConfigs {
  production?: CfPagesDeploymentConfig;
  preview?: CfPagesDeploymentConfig;
}

export interface CfPagesProject {
  name: string;
  production_branch?: string;
  deployment_configs?: CfPagesDeploymentConfigs;
}

export type CfApiClientErrorKind = "network" | "api" | "parse";

export class CfApiClientError extends Error {
  readonly kind: CfApiClientErrorKind;
  readonly statusCode?: number | undefined;
  readonly cfErrors?: CfApiError[] | undefined;

  constructor(kind: CfApiClientErrorKind, message: string, opts?: { statusCode?: number; cfErrors?: CfApiError[] }) {
    super(message);
    this.name = "CfApiClientError";
    this.kind = kind;
    this.statusCode = opts?.statusCode;
    this.cfErrors = opts?.cfErrors;
  }
}
