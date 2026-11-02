import type { Result } from "../../../result/types";
import type { v } from "../../../validation/validation";
import type { CF_OPERATIONS } from "./operations";

export interface CfApiError {
  code: number;
  message: string;
}

export type CfD1Database = v.InferOutput<typeof CF_OPERATIONS.createD1Database.result>;

export type CfWorkerBinding = v.InferOutput<typeof CF_OPERATIONS.getWorkerSettings.result>["bindings"][number];

export type CfApiClientErrorKind = "network" | "api" | "parse" | "paging" | "schema";

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

export type CfPaging = "page" | "cursor";

export interface CfOperation<T> {
  name: string;
  result: v.GenericSchema<unknown, T>;
}

export interface CfListOperation<T> extends CfOperation<T[]> {
  paging: CfPaging;
}

export interface CfClient {
  get<T>(path: string, operation: CfOperation<T>): Promise<Result<T, CfApiClientError>>;
  list<T>(path: string, operation: CfListOperation<T>): Promise<Result<T[], CfApiClientError>>;
  post<T>(path: string, body: unknown, operation: CfOperation<T>): Promise<Result<T, CfApiClientError>>;
  put<T>(path: string, body: unknown, operation: CfOperation<T>): Promise<Result<T, CfApiClientError>>;
  patch<T>(path: string, body: unknown, operation: CfOperation<T>): Promise<Result<T, CfApiClientError>>;
}

/** Why a Cloudflare call failed, at the granularity a result row cares about. */
export type CfFailureKind = "not-found" | "auth" | "network" | "other";

/** An API-token permission, as an auth failure names it. */
export interface CfTokenPermission {
  name: string;
  /** Which access level each kind of run needs, and any restriction on the token that carries it. */
  grants: string;
}

export interface DescribeCfFailureOptions {
  /** Never interpolate the upstream message, which can echo a secret out of the rejected request body. */
  redactMessage?: boolean;
  /** The permission an auth failure names; `WORKER_PERMISSION` when absent. */
  permission?: CfTokenPermission;
}
