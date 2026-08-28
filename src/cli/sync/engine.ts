import { sanitizeName } from "./handlers/naming";
import { defaultHandlers } from "./handlers/registry";
import type { ResourceHandler } from "./handlers/types";
import { detectTarget } from "./target";
import type { ResolvedPrefix, ResourceType, SyncConfig, SyncOutput, WranglerConfig } from "./types";

function resolvePrefix(config: SyncConfig, scriptName: string): ResolvedPrefix {
  const strategy = config.prefix ?? { kind: "project-name" };
  switch (strategy.kind) {
    case "none":
      return "";
    case "custom":
      return sanitizeName(strategy.prefix);
    case "project-name":
      return sanitizeName(scriptName.toUpperCase());
  }
}

// Deep equality check for primitive-valued configs (sufficient for wrangler config arrays)
function configChanged(original: WranglerConfig, updated: WranglerConfig): boolean {
  return JSON.stringify(original) !== JSON.stringify(updated);
}

export async function syncBindings(
  config: WranglerConfig,
  syncConfig: SyncConfig,
  handlers: ResourceHandler[] = defaultHandlers,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<SyncOutput> {
  const scriptName = syncConfig.scriptName ?? config.name;
  const prefix = resolvePrefix(syncConfig, scriptName);
  const dryRun = syncConfig.dryRun ?? false;
  const target = detectTarget(config, scriptName);

  // Filter to requested resource types if specified
  const resourceFilter = syncConfig.resources;
  const activeHandlers = resourceFilter ? handlers.filter((h) => resourceFilter.includes(h.type as ResourceType)) : handlers;

  let updatedConfig = { ...config };
  const allResults: SyncOutput["results"] = [];
  const allNotes: SyncOutput["notes"] = [];

  // Identical for every handler, so it is built once rather than per iteration.
  const ctx = { auth: syncConfig.auth, scriptName, prefix, dryRun, fetch: fetchFn, target, rotate: new Set(syncConfig.rotate ?? []) };

  for (const handler of activeHandlers) {
    const entries = handler.extract(updatedConfig);
    // A handler that opts into `reportsEmpty` still runs on an empty extract, so it
    // can say "looked, found nothing" rather than vanishing from the output.
    if (entries.length === 0 && !handler.reportsEmpty) continue;

    const { entries: reconciled, results, notes } = await (handler as ResourceHandler<unknown>).reconcile(entries, ctx);
    allResults.push(...results);
    for (const message of notes ?? []) allNotes.push({ resourceType: handler.type as ResourceType, message });

    // Merge reconciled entries back — only update the specific binding array
    updatedConfig = mergeEntries(updatedConfig, handler.type as ResourceType, reconciled);
  }

  return { results: allResults, notes: allNotes, updatedConfig, configChanged: configChanged(config, updatedConfig), target, prefix };
}

function mergeEntries(config: WranglerConfig, type: ResourceType, entries: unknown[]): WranglerConfig {
  switch (type) {
    case "kv_namespaces":
      return { ...config, kv_namespaces: entries as NonNullable<WranglerConfig["kv_namespaces"]> };
    case "d1_databases":
      return { ...config, d1_databases: entries as NonNullable<WranglerConfig["d1_databases"]> };
    case "r2_buckets":
      return { ...config, r2_buckets: entries as NonNullable<WranglerConfig["r2_buckets"]> };
    case "queues": {
      type QueueProducer = NonNullable<NonNullable<WranglerConfig["queues"]>["producers"]>;
      const producers = entries as QueueProducer;
      return { ...config, queues: { ...(config.queues ?? {}), producers } };
    }
    // These resource types have no server-assigned ID to write back into the config.
    case "local_vars":
    case "vars":
    case "secrets":
    case "rotatable_secrets":
    case "ratelimits":
    case "durable_objects":
    case "hyperdrive":
    case "vectorize":
    case "ai":
    case "browser":
    case "analytics_engine_datasets":
    case "services":
    case "send_email":
    case "dispatch_namespaces":
    case "mtls_certificates":
    case "workflows":
    case "pipelines":
      return config;
    // Exhaustiveness guard: a new write-back ResourceType added without a case above
    // makes `type` no longer assignable to `never`, surfacing as a compile error here.
    default:
      return ((_exhaustive: never): WranglerConfig => config)(type);
  }
}
