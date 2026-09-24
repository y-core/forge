import type { Colorize } from "../term/types";

/** Cloudflare API credentials, always supplied from the environment or from flags. */
export interface CfAuth {
  readonly apiToken: string;
  readonly accountId: string;
}

/** Every resource type the tool knows how to report on, and the source `ResourceType` is derived from. */
export const RESOURCE_TYPES = [
  "kv_namespaces",
  "d1_databases",
  "r2_buckets",
  "queues",
  "local_vars",
  "vars",
  "secrets",
  "rotatable_secrets",
  "ratelimits",
  "durable_objects",
  "hyperdrive",
  "vectorize",
  "ai",
  "browser",
  "analytics_engine_datasets",
  "services",
  "send_email",
  "dispatch_namespaces",
  "mtls_certificates",
  "workflows",
  "pipelines",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export type PrefixStrategy = { kind: "project-name" } | { kind: "custom"; prefix: string } | { kind: "none" };

export type ResolvedPrefix = string; // empty string = no prefix

/** What a handler is saying about one binding, in a vocabulary uniform across every handler. */
export type SyncAction =
  | "in-sync"
  | "local-only"
  | "deploy-pushes"
  | "drift"
  | "would-create"
  | "would-rotate"
  | "created"
  | "updated"
  | "rotated"
  | "remote-only"
  | "unavailable"
  | "refused"
  | "error";

/** How each action is spelled in a table cell. */
export const ACTION_LABELS: Record<SyncAction, string> = {
  "in-sync": "in sync",
  "local-only": "local only",
  "deploy-pushes": "deploy pushes",
  drift: "drift",
  "would-create": "create on --commit",
  "would-rotate": "rotate on --commit",
  created: "created",
  updated: "updated",
  rotated: "rotated",
  "remote-only": "remote only",
  unavailable: "unavailable",
  refused: "refused",
  error: "error",
};

export interface SyncResult {
  resourceType: ResourceType;
  binding: string;
  remoteName?: string | undefined;
  action: SyncAction;
  remoteId?: string | undefined;
  detail?: string | undefined;
  /** Where the name was found; undefined for a side that was never queried. */
  local?: boolean | undefined;
  remote?: boolean | undefined;
}

/** A remark about a whole resource type rather than about one binding. */
export interface SyncNote {
  resourceType: ResourceType;
  message: string;
}

export interface SyncOutput {
  results: SyncResult[];
  /** Remarks about a resource type as a whole; rendered under its section. */
  notes: SyncNote[];
  updatedConfig: WranglerConfig;
  configChanged: boolean;
  /** The surface every row was compared against. */
  target: DeploymentTarget;
  /** The resolved name prefix, so a report can state the naming convention it applied. */
  prefix: ResolvedPrefix;
}

export interface SyncConfig {
  auth: CfAuth;
  scriptName?: string | undefined;
  resources?: ResourceType[] | undefined;
  prefix?: PrefixStrategy | undefined;
  dryRun?: boolean | undefined;
  /** Secret names to regenerate rather than push from `.dev.vars`. */
  rotate?: readonly string[] | undefined;
}

export interface KvNamespaceConfig {
  binding: string;
  id?: string;
  preview_id?: string;
}

export interface D1DatabaseConfig {
  binding: string;
  database_id?: string;
  database_name?: string;
  preview_database_id?: string;
  /** Where `wrangler d1 migrations` reads, relative to the config. Defaults to `migrations`. */
  migrations_dir?: string;
  /** The table wrangler records applied migrations in. Defaults to `d1_migrations`. */
  migrations_table?: string;
}

export interface R2BucketConfig {
  binding: string;
  bucket_name?: string;
}

export interface QueueProducerConfig {
  binding: string;
  queue?: string;
  queue_id?: string;
}

export interface QueueConsumerConfig {
  queue: string;
  max_batch_size?: number;
  max_batch_timeout?: number;
  max_retries?: number;
  dead_letter_queue?: string;
}

export interface RateLimitConfig {
  name: string;
  namespace_id: string;
  simple?: { limit: number; period: number };
}

export interface DurableObjectConfig {
  name: string;
  class_name: string;
  script_name?: string;
  environment?: string;
}

export interface HyperdriveConfig {
  binding: string;
  id: string;
}

export interface VectorizeConfig {
  binding: string;
  index_name: string;
}

export interface AnalyticsEngineConfig {
  binding: string;
  dataset?: string;
}

export interface ServiceConfig {
  binding: string;
  service: string;
  environment?: string;
}

export interface SendEmailConfig {
  name: string;
  destination_address?: string;
}

export interface DispatchNamespaceConfig {
  binding: string;
  namespace: string;
}

export interface MtlsCertificateConfig {
  binding: string;
  certificate_id: string;
}

export interface WorkflowConfig {
  binding: string;
  name: string;
  class_name: string;
  script_name?: string;
}

export interface PipelineConfig {
  binding: string;
  pipeline: string;
}

export interface WranglerConfig {
  name: string;
  /** Worker entry point. Mutually exclusive with `pages_build_output_dir`. */
  main?: string;
  /** Pages build output directory. Its presence (without `main`) marks a Pages project. */
  pages_build_output_dir?: string;
  vars?: Record<string, string>;
  kv_namespaces?: KvNamespaceConfig[];
  d1_databases?: D1DatabaseConfig[];
  r2_buckets?: R2BucketConfig[];
  queues?: { producers?: QueueProducerConfig[]; consumers?: QueueConsumerConfig[] };
  ratelimits?: RateLimitConfig[];
  durable_objects?: { bindings?: DurableObjectConfig[] };
  hyperdrive?: HyperdriveConfig[];
  vectorize?: VectorizeConfig[];
  ai?: { binding: string };
  browser?: { binding: string };
  analytics_engine_datasets?: AnalyticsEngineConfig[];
  services?: ServiceConfig[];
  send_email?: SendEmailConfig[];
  dispatch_namespaces?: DispatchNamespaceConfig[];
  mtls_certificates?: MtlsCertificateConfig[];
  workflows?: WorkflowConfig[];
  pipelines?: PipelineConfig[];
  [key: string]: unknown;
}

export type TableRow = Record<string, string>;

/** How to render a grid: what to style it with, and what it has to fit in. */
export interface TableOptions {
  /** Styler for the headings. Defaults to `PLAIN`, so output carries no escape sequence unless asked. */
  style?: Colorize;
  /** Columns the grid must fit in; omitted, it is as wide as its content. */
  width?: number;
  /** Columns permitted to wrap when `width` forces a shrink; every other column is truncated instead. */
  wrap?: readonly string[];
}

/** One heading, an optional one-line rule that governs every row under it, and the rows. */
export interface TableSection {
  title: string;
  note?: string;
  rows: TableRow[];
  /** Lines printed under the grid — remarks about the section rather than about any binding in it. */
  footers?: string[];
}

/** Where this config deploys to, which decides the API surface a handler addresses. */
export type DeploymentTarget = { kind: "worker" | "pages"; name: string };
