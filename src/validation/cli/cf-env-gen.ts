/** cf-env-gen.ts — portable, schema-first generator for the Cloudflare binding/var surface.
 *
 *  A reusable, IO-free core that re-creates the env half of `wrangler types …
 *  --include-env --no-include-runtime` as a committed valibot module: a runtime
 *  `EnvSchema` plus `type Env = v.InferOutput<typeof EnvSchema>`. The runnable command
 *  (file IO, CLI flags, formatting) lives next door in `cf-env-command.ts`; everything
 *  here is pure so both ship together under `@y-core/forge/validation/cli`.
 *
 *  The heart is `REGISTRY` — a data table mirroring wrangler's own binding-emission
 *  loop (`collectCoreBindings` in `wrangler@4.103.0`'s `wrangler-dist/cli.js`). Each
 *  row is a *(configKey → nameField → TS type)* triple, in wrangler's collection order,
 *  so a host's configured subset keeps the same relative order wrangler would emit.
 *
 *  Two deliberate simplifications vs wrangler, both inert unless the kind is configured:
 *    - **Base (non-generic) TS types** — `DurableObjectNamespace`/`Service`/`Workflow`,
 *      never the `<ClassName>`/`<Entrypoint>` parameterised forms wrangler derives from
 *      worker entrypoints (it has no access to those here).
 *    - **Out of scope**: module `rules`, `data_blobs`/`text_blobs`, `logfwdr`, pipelines,
 *      and `unsafe` bindings — none are env bindings a host declares for this schema.
 */

/** One binding flavour: where it lives in config, how its name is read, and its TS type.
 *  `shape:"list"` walks an array; `shape:"object"` reads a single `{ binding }` object. @public */
export interface BindingDef {
  /** Dotted path into the wrangler config (e.g. `"queues.producers"`). */
  configKey: string;
  /** The field on each entry holding the JS identifier of the binding. */
  nameField: "binding" | "name";
  /** The Cloudflare ambient TS type the `v.custom<T>` generic references. */
  tsType: string;
  /** Whether `configKey` resolves to an array of entries or a single object. */
  shape: "list" | "object";
  /** Human-readable kind label (diagnostics / coverage tests). */
  label: string;
  /** The validation message for a binding of this kind named `n`. */
  message: (n: string) => string;
}

/** One emitted schema entry: a binding/var key and its valibot expression. @public */
export interface Entry {
  name: string;
  expr: string;
}

/** Host policy layered over the generated schema. @public */
export interface GenOptions {
  /** Binding names wrapped in `v.optional` (absent in some environments). */
  optional: Set<string>;
  /** Per-var refinements applied on top of the inferred base schema. */
  refinements: Record<string, { minLength?: number }>;
  /** The inline `v.custom` check expression every binding shares (a presence/shape
   *  floor); the exact type is carried by each `v.custom<T>` generic, not this check. */
  bindingCheck: string;
}

/** Sensible default policy used when no `--config` module is supplied: nothing optional,
 *  no refinements, and the presence/shape binding floor. A host overrides any field with a
 *  `Partial<GenOptions>` config module (see `loadOptions`). @public */
export const DEFAULT_OPTIONS: GenOptions = {
  optional: new Set<string>(),
  refinements: {},
  bindingCheck: '(x) => typeof x === "object" && x !== null',
};

/** The generated module's header (doc comment). Generic by design — every emitted schema
 *  documents the same contract — so it is baked in here, not part of the host's `GenOptions`. @public */
export const HEADER = `/** env.schema.ts — GENERATED — do not edit; run \`bun run gen:env\`.
 *
 *  Schema-first replacement for \`wrangler types … --no-include-runtime\`. The single
 *  source of truth for the Worker binding/var surface, emitted by the \`gen-env\` command
 *  from \`wrangler.jsonc\` bindings + \`.dev.vars\` keys. \`EnvSchema\` is the runtime
 *  contract enforced by \`validateBindings\`; \`type Env\` is its compile-time face.
 */`;

/** The binding-kind table, in `wrangler@4.103.0`'s emission order. List kinds first
 *  (its `collectCoreBindings` loop), then the single-object kinds it checks inline, then
 *  durable objects / services / workflows (wrangler's separate collectors, emitted after
 *  the core bindings). The four common kinds (KV, R2, ratelimit, Fetcher) keep their
 *  messages verbatim so the generated module stays byte-stable. @public */
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

/** Strip `//` and block comments from JSONC, string-aware so `//` inside a string survives. @public */
export function stripJsonc(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++; // skip the closing '/'
      continue;
    }
    out += ch;
  }
  return out;
}

/** Resolve a (possibly dotted) path through an object, returning `undefined` on any gap. */
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

/** Build a binding entry for `name`, wrapping in `v.optional` when policy marks it optional. */
function bindingEntry(name: string, def: BindingDef, opts: GenOptions): Entry {
  const base = `v.custom<${def.tsType}>(${opts.bindingCheck}, "${def.message(name)}")`;
  return { name, expr: opts.optional.has(name) ? `v.optional(${base})` : base };
}

/** Collect binding entries from `cfg`, walking `REGISTRY` in order. @public */
export function collectBindings(cfg: Record<string, unknown>, opts: GenOptions): Entry[] {
  const entries: Entry[] = [];
  for (const def of REGISTRY) {
    const node = getPath(cfg, def.configKey);
    if (def.shape === "list") {
      const list = Array.isArray(node) ? node : [];
      for (const item of list) {
        const name = (item as Record<string, unknown> | null)?.[def.nameField];
        if (typeof name === "string" && name) entries.push(bindingEntry(name, def, opts));
      }
      continue;
    }
    const name = (node as Record<string, unknown> | null)?.[def.nameField];
    if (node && typeof name === "string" && name) entries.push(bindingEntry(name, def, opts));
  }
  return entries;
}

/** Apply a name's `minLength` refinement to a string base, else return the base unchanged. */
function refine(name: string, base: string, opts: GenOptions): string {
  const min = opts.refinements[name]?.minLength;
  if (min != null && base === "v.string()") return `v.pipe(v.string(), v.minLength(${min}))`;
  return base;
}

/** Collect var entries: typed `wrangler.jsonc` `vars` first, then `.dev.vars` secrets
 *  (all `v.string()`). `.dev.vars` wins on name collisions (secret precedence). @public */
export function collectVars(devVarsText: string, wranglerVars: Record<string, unknown>, opts: GenOptions): Entry[] {
  const secretNames = new Set<string>();
  for (const line of devVarsText.split("\n")) {
    const name = /^([A-Z_][A-Z0-9_]*)=/.exec(line.trim())?.[1];
    if (name) secretNames.add(name);
  }

  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(wranglerVars)) {
    if (secretNames.has(name)) continue; // secret takes precedence
    const base = typeof value === "number" ? "v.number()" : typeof value === "boolean" ? "v.boolean()" : "v.string()";
    entries.push({ name, expr: refine(name, base, opts) });
    seen.add(name);
  }
  for (const line of devVarsText.split("\n")) {
    const name = /^([A-Z_][A-Z0-9_]*)=/.exec(line.trim())?.[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    entries.push({ name, expr: refine(name, "v.string()", opts) });
  }
  return entries;
}

/** Render the full env-schema module text for the collected entries (with the baked `HEADER`). @public */
export function emit(entries: Entry[]): string {
  const body = entries.map((e) => `  ${e.name}: ${e.expr},`).join("\n");
  return `${HEADER}

import { v } from "@y-core/forge/validation";

/** The Worker's binding/var surface as a runtime valibot schema. */
export const EnvSchema = v.object({
${body}
});

/** The Worker's binding/var surface as a type — inferred from \`EnvSchema\`. */
export type Env = v.InferOutput<typeof EnvSchema>;
`;
}
