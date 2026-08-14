/** One binding flavour: where it lives in config, how its name is read, and its TS type. @internal */
export interface BindingDef {
  configKey: string;
  nameField: "binding" | "name";
  tsType: string;
  shape: "list" | "object";
  label: string;
  message: (n: string) => string;
}

/** One emitted schema entry: a binding/var key and its valibot expression. @internal */
export interface Entry {
  name: string;
  expr: string;
}

/** Host policy layered over the generated schema. @public */
export interface GenOptions {
  optional: Set<string>;
  refinements: Record<string, { minLength?: number }>;
  bindingCheck: string;
}

/** Default policy used when no `--config` module is supplied: nothing optional, no refinements, and the presence/shape binding floor. @internal */
export const DEFAULT_OPTIONS: GenOptions = {
  optional: new Set<string>(),
  refinements: {},
  bindingCheck: '(x) => typeof x === "object" && x !== null',
};

/** The generated module's header comment. @internal */
export const HEADER = `/** env.schema.ts — GENERATED — do not edit; run \`bun run gen:env\`.
 *
 *  Schema-first replacement for \`wrangler types … --no-include-runtime\`. The single
 *  source of truth for the Worker binding/var surface, emitted by the \`gen-env\` command
 *  from \`wrangler.jsonc\` bindings + \`.dev.vars\` keys. \`EnvSchema\` is the runtime
 *  contract enforced by \`validateBindings\`; \`type Env\` is its compile-time face.
 */`;

/** The binding-kind table, in `wrangler@4.103.0`'s own emission order. @internal */
export const REGISTRY: readonly BindingDef[] = [
  {
    configKey: "kv_namespaces",
    nameField: "binding",
    tsType: "KVNamespace",
    shape: "list",
    label: "KV namespace",
    message: (n) => `${n} must be a KV namespace binding`,
  },
  {
    configKey: "r2_buckets",
    nameField: "binding",
    tsType: "R2Bucket",
    shape: "list",
    label: "R2 bucket",
    message: (n) => `${n} must be an R2 bucket binding`,
  },
  {
    configKey: "d1_databases",
    nameField: "binding",
    tsType: "D1Database",
    shape: "list",
    label: "D1 database",
    message: (n) => `${n} must be a D1 database binding`,
  },
  {
    configKey: "vectorize",
    nameField: "binding",
    tsType: "VectorizeIndex",
    shape: "list",
    label: "Vectorize index",
    message: (n) => `${n} must be a Vectorize index binding`,
  },
  {
    configKey: "hyperdrive",
    nameField: "binding",
    tsType: "Hyperdrive",
    shape: "list",
    label: "Hyperdrive",
    message: (n) => `${n} must be a Hyperdrive binding`,
  },
  {
    configKey: "send_email",
    nameField: "name",
    tsType: "SendEmail",
    shape: "list",
    label: "send-email",
    message: (n) => `${n} must be a send-email binding`,
  },
  {
    configKey: "analytics_engine_datasets",
    nameField: "binding",
    tsType: "AnalyticsEngineDataset",
    shape: "list",
    label: "Analytics Engine dataset",
    message: (n) => `${n} must be an Analytics Engine dataset binding`,
  },
  {
    configKey: "dispatch_namespaces",
    nameField: "binding",
    tsType: "DispatchNamespace",
    shape: "list",
    label: "dispatch namespace",
    message: (n) => `${n} must be a dispatch-namespace binding`,
  },
  {
    configKey: "mtls_certificates",
    nameField: "binding",
    tsType: "Fetcher",
    shape: "list",
    label: "mTLS certificate",
    message: (n) => `${n} must be an mTLS-certificate binding`,
  },
  {
    configKey: "queues.producers",
    nameField: "binding",
    tsType: "Queue",
    shape: "list",
    label: "Queue producer",
    message: (n) => `${n} must be a Queue binding`,
  },
  {
    configKey: "secrets_store_secrets",
    nameField: "binding",
    tsType: "SecretsStoreSecret",
    shape: "list",
    label: "Secrets Store secret",
    message: (n) => `${n} must be a Secrets Store secret binding`,
  },
  {
    configKey: "artifacts",
    nameField: "binding",
    tsType: "Artifacts",
    shape: "list",
    label: "artifacts",
    message: (n) => `${n} must be an artifacts binding`,
  },
  {
    configKey: "unsafe_hello_world",
    nameField: "binding",
    tsType: "HelloWorldBinding",
    shape: "list",
    label: "hello-world",
    message: (n) => `${n} must be a hello-world binding`,
  },
  {
    configKey: "flagship",
    nameField: "binding",
    tsType: "Flagship",
    shape: "list",
    label: "flagship",
    message: (n) => `${n} must be a flagship binding`,
  },
  {
    configKey: "ratelimits",
    nameField: "name",
    tsType: "RateLimit",
    shape: "list",
    label: "rate-limit",
    message: (n) => `${n} must be a rate-limit binding`,
  },
  {
    configKey: "worker_loaders",
    nameField: "binding",
    tsType: "WorkerLoader",
    shape: "list",
    label: "worker loader",
    message: (n) => `${n} must be a worker-loader binding`,
  },
  {
    configKey: "vpc_services",
    nameField: "binding",
    tsType: "Fetcher",
    shape: "list",
    label: "VPC service",
    message: (n) => `${n} must be a VPC-service binding`,
  },
  {
    configKey: "vpc_networks",
    nameField: "binding",
    tsType: "Fetcher",
    shape: "list",
    label: "VPC network",
    message: (n) => `${n} must be a VPC-network binding`,
  },
  {
    configKey: "ai_search_namespaces",
    nameField: "binding",
    tsType: "AiSearchNamespace",
    shape: "list",
    label: "AI Search namespace",
    message: (n) => `${n} must be an AI Search namespace binding`,
  },
  {
    configKey: "ai_search",
    nameField: "binding",
    tsType: "AiSearchInstance",
    shape: "list",
    label: "AI Search",
    message: (n) => `${n} must be an AI Search binding`,
  },
  {
    configKey: "websearch",
    nameField: "binding",
    tsType: "WebSearch",
    shape: "object",
    label: "web-search",
    message: (n) => `${n} must be a web-search binding`,
  },
  {
    configKey: "agent_memory",
    nameField: "binding",
    tsType: "AgentMemoryNamespace",
    shape: "list",
    label: "agent-memory",
    message: (n) => `${n} must be an agent-memory binding`,
  },
  {
    configKey: "browser",
    nameField: "binding",
    tsType: "BrowserRun",
    shape: "object",
    label: "browser",
    message: (n) => `${n} must be a browser binding`,
  },
  { configKey: "ai", nameField: "binding", tsType: "Ai", shape: "object", label: "AI", message: (n) => `${n} must be an AI binding` },
  {
    configKey: "images",
    nameField: "binding",
    tsType: "ImagesBinding",
    shape: "object",
    label: "Images",
    message: (n) => `${n} must be an Images binding`,
  },
  {
    configKey: "stream",
    nameField: "binding",
    tsType: "StreamBinding",
    shape: "object",
    label: "Stream",
    message: (n) => `${n} must be a Stream binding`,
  },
  {
    configKey: "media",
    nameField: "binding",
    tsType: "MediaBinding",
    shape: "object",
    label: "Media",
    message: (n) => `${n} must be a Media binding`,
  },
  {
    configKey: "version_metadata",
    nameField: "binding",
    tsType: "WorkerVersionMetadata",
    shape: "object",
    label: "version metadata",
    message: (n) => `${n} must be a version-metadata binding`,
  },
  {
    configKey: "assets",
    nameField: "binding",
    tsType: "Fetcher",
    shape: "object",
    label: "assets",
    message: (n) => `${n} must be a Fetcher binding`,
  },
  {
    configKey: "durable_objects.bindings",
    nameField: "name",
    tsType: "DurableObjectNamespace",
    shape: "list",
    label: "Durable Object",
    message: (n) => `${n} must be a Durable Object binding`,
  },
  {
    configKey: "services",
    nameField: "binding",
    tsType: "Service",
    shape: "list",
    label: "service",
    message: (n) => `${n} must be a service binding`,
  },
  {
    configKey: "workflows",
    nameField: "binding",
    tsType: "Workflow",
    shape: "list",
    label: "workflow",
    message: (n) => `${n} must be a workflow binding`,
  },
];
