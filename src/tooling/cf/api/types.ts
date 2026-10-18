import type { Result } from "../../../result/types";
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

export interface CfClient {
  get<T>(path: string): Promise<Result<T, CfApiClientError>>;
  list<T>(path: string): Promise<Result<T[], CfApiClientError>>;
  post<T>(path: string, body: unknown): Promise<Result<T, CfApiClientError>>;
  put<T>(path: string, body: unknown): Promise<Result<T, CfApiClientError>>;
  patch<T>(path: string, body: unknown): Promise<Result<T, CfApiClientError>>;
  delete<T>(path: string): Promise<Result<T, CfApiClientError>>;
}

/** Why a Cloudflare call failed, at the granularity a result row cares about. */
export type CfFailureKind = "not-found" | "auth" | "network" | "other";

export interface DescribeCfFailureOptions {
  /** Never interpolate the upstream message, which can echo a secret out of the rejected request body. */
  redactMessage?: boolean;
}
