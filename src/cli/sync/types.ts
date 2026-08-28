import type { DeploymentTarget } from "./target";

// Auth credentials — always from env or flags, never hardcoded
export interface CfAuth {
  readonly apiToken: string;
  readonly accountId: string;
}

/**
 * Every resource type the tool knows how to report on.
 *
 * Declared as a value so `--resources` can validate against it; `ResourceType` is
 * derived from it, which is what keeps the CLI's idea of a valid type and the
 * compiler's from drifting apart.
 */
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

/**
 * What a handler is saying about one binding. The vocabulary is uniform across
 * every handler, so that a reader can trust a column rather than a handler.
 *
 * Each value answers one question — **what happens to this name next, and who
 * does it** — because that is the question a status report is read to answer:
 *
 * | action          | meaning                                                                        |
 * |-----------------|--------------------------------------------------------------------------------|
 * | `in-sync`       | verified present on both sides; nothing to do                                   |
 * | `local-only`    | by design never goes remote — an unmarked `.dev.vars` key                        |
 * | `deploy-pushes` | the next `wrangler deploy` puts it there; this tool never writes it              |
 * | `drift`         | present on both sides, and the two disagree                                     |
 * | `would-create`  | `--commit` would create it here                                                 |
 * | `would-rotate`  | `--commit` would generate a new value remotely — the local one is never sent    |
 * | `created`       | a write happened — it did not exist and now does                                |
 * | `updated`       | a write happened — it existed and its value was changed                         |
 * | `rotated`       | a write happened — a freshly generated value replaced the remote one            |
 * | `remote-only`   | present remotely and declared nowhere locally                                   |
 * | `unavailable`   | the remote target does not exist, or the surface cannot carry this binding      |
 * | `error`         | the operation failed; `detail` carries the cause                                |
 *
 * `unavailable` is reserved for a missing *remote target* — a Pages project or
 * Worker script that is not there. A would-create is `would-create`, not
 * `unavailable`: nothing is missing that a `--commit` would not create.
 */
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
  | "error";

/**
 * How each action is spelled in a table cell.
 *
 * Beside the union rather than in the renderer, so a new action cannot be added
 * without deciding what it says to a reader — the `Record` makes that a compile
 * error rather than a blank cell.
 */
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
  error: "error",
};

export interface SyncResult {
  resourceType: ResourceType;
  binding: string;
  remoteName?: string | undefined;
  action: SyncAction;
  remoteId?: string | undefined;
  detail?: string | undefined;
  /**
   * Where the name was found. Reported rather than inferred from `action`,
   * because the two failure actions — `error` and `unavailable` — say nothing
   * about presence, and a blank cell is the honest answer for a side that was
   * never queried.
   */
  local?: boolean | undefined;
  remote?: boolean | undefined;
}

/**
 * A remark about a whole resource type rather than about one binding.
 *
 * Separate from `SyncResult` because the two answer different questions. "There is no
 * `.dev.vars` at this path" has no binding, no action and no remote counterpart, and
 * forcing it into a row meant inventing all three.
 */
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
  /**
   * The surface every row was compared against. Reported so a caller can state it
   * once rather than reading it back out of the detail strings.
   */
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
  /**
   * Secret names to regenerate rather than push from `.dev.vars`.
   *
   * Validated against the rotate markers in `.dev.vars` before the run starts, so a
   * name reaching here has already been declared rotatable.
   */
  rotate?: readonly string[] | undefined;
}

// Per-binding config shapes

export interface KvNamespaceConfig {
  binding: string;
  id?: string;
  preview_id?: string;
}

export interface D1DatabaseConfig {
  binding: string;
  database_id?: string;
  database_name?: string;
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
