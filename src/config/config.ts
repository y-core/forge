import { parseEnv } from "../validation/parse-env";
import { v } from "../validation/validation";
import type { ConfigDescriptor, ConfigOverrides, EnvMapping, EnvRef } from "./types";

function resolve<ConfigData>(bindings: object, descriptor: ConfigDescriptor<ConfigData>): ConfigData {
  const record = bindings as Record<string, unknown>;
  const mapped = applyMapping(record, descriptor.map);
  let config = parseEnv(descriptor.schema, mapped);
  if (descriptor.overrides?.detect(record)) {
    config = descriptor.overrides.patch(config);
  }
  return config;
}

/** Builds an {@link EnvRef} referencing the named env var for use in a config mapping. @public */
export function env<K extends string>(name: K): EnvRef<K> {
  return { __env: name };
}

/** Recursively projects an env record through an {@link EnvMapping}. @internal */
export function applyMapping(source: Record<string, unknown>, map: EnvMapping): unknown {
  if (typeof map === "string") return map;
  if ("__env" in map) return source[(map as EnvRef).__env];
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map)) {
    result[key] = applyMapping(source, value);
  }
  return result;
}

// An unset Workers secret and an empty `.dev.vars` line both arrive as `""`, so a required key
// holding one is unconfigured. The exact empty string only: length and format are the entry schema's.
function absent(value: unknown): boolean {
  return value == null || value === "";
}

/** Builds a schema for an optional config group that resolves to `null` when required keys are absent. @public */
export function optionalGroup<T extends Record<string, v.GenericSchema>>(
  entries: T,
  options: { required: (keyof T & string)[] | "all"; defaults?: Partial<Record<keyof T & string, unknown>> },
): v.GenericSchema<unknown, { [K in keyof T]: v.InferOutput<T[K]> } | null> {
  const requiredKeys = options.required === "all" ? Object.keys(entries) : options.required;
  const defaults = options.defaults ?? {};
  const group = v.nullable(v.object(entries));

  const gate = v.transform((raw: unknown): unknown => {
    const input = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    for (const key of requiredKeys) {
      if (absent(input[key])) return null;
    }
    const result: Record<string, unknown> = { ...input };
    for (const [key, defaultVal] of Object.entries(defaults)) {
      if (absent(result[key])) result[key] = defaultVal;
    }
    return result;
  });

  return v.pipe(v.unknown(), gate, group as v.GenericSchema<unknown, { [K in keyof T]: v.InferOutput<T[K]> } | null>);
}

/** Builds a schema for a config group whose every key must be present, raising a valibot issue naming any that is not. @public */
export function requiredGroup<T extends Record<string, v.GenericSchema>>(
  entries: T,
  options: { defaults?: Partial<Record<keyof T & string, unknown>> } = {},
): v.GenericSchema<unknown, { [K in keyof T]: v.InferOutput<T[K]> }> {
  const keys = Object.keys(entries);
  const defaults = options.defaults ?? {};

  const requirePresent = v.rawTransform<unknown, unknown>(({ dataset, addIssue, NEVER }) => {
    const raw = dataset.value;
    const input = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const result: Record<string, unknown> = { ...input };
    for (const [key, defaultVal] of Object.entries(defaults)) {
      if (absent(result[key])) result[key] = defaultVal;
    }
    // One issue per key, each carrying the key on its path, so `formatEnvIssues` names the env var
    // that is absent rather than only the group it belongs to.
    let missing = false;
    for (const key of keys) {
      if (!absent(result[key])) continue;
      missing = true;
      addIssue({ received: "undefined", path: [{ type: "object", origin: "value", input: result, key, value: result[key] }] });
    }
    return missing ? NEVER : result;
  });

  return v.pipe(v.unknown(), requirePresent, v.object(entries) as v.GenericSchema<unknown, { [K in keyof T]: v.InferOutput<T[K]> }>);
}

/** Returns config from store, or an empty object cast to T when no store is registered. @public */
export function resolveConfig<T>(store: Config<T> | undefined, bindings: object): T {
  return (store ? store.get(bindings) : {}) as T;
}

/** Lazy config holder that resolves and caches parsed config per distinct `env`. @public */
export class Config<ConfigData> {
  #cache = new WeakMap<object, ConfigData>();
  #seed: ConfigData | undefined;
  #hasSeed = false;
  readonly #resolve: (bindings: object) => ConfigData;

  private constructor(map: EnvMapping, schema: v.BaseSchema<unknown, ConfigData, v.BaseIssue<unknown>>, overrides?: ConfigOverrides<ConfigData>) {
    const descriptor: ConfigDescriptor<ConfigData> = { map, schema, ...(overrides ? { overrides } : {}) };
    this.#resolve = (bindings: object) => resolve(bindings, descriptor);
  }

  /** Instantiates a holder; prefer the {@link createConfig} factory. @internal */
  static create<ConfigData>(
    map: EnvMapping,
    schema: v.BaseSchema<unknown, ConfigData, v.BaseIssue<unknown>>,
    overrides?: ConfigOverrides<ConfigData>,
  ): Config<ConfigData> {
    return new Config(map, schema, overrides);
  }

  /** Resolves config for `env`, caching the parsed result. */
  get(bindings: object): ConfigData {
    if (this.#hasSeed) return this.#seed as ConfigData;
    const hit = this.#cache.get(bindings);
    if (hit) return hit;
    const resolved = this.#resolve(bindings);
    this.#cache.set(bindings, resolved);
    return resolved;
  }

  /** Seeds a fixed config returned by every `get()`, bypassing resolution. */
  seed(config: ConfigData): void {
    this.#seed = config;
    this.#hasSeed = true;
  }

  /** Clears the seed and the per-env cache, forcing re-resolution. */
  reset(): void {
    this.#seed = undefined;
    this.#hasSeed = false;
    this.#cache = new WeakMap<object, ConfigData>();
  }
}

/** Creates a lazy config holder that resolves and caches parsed config per distinct `env`. @public */
export function createConfig<ConfigData>(
  map: EnvMapping,
  schema: v.BaseSchema<unknown, ConfigData, v.BaseIssue<unknown>>,
  overrides?: ConfigOverrides<ConfigData>,
): Config<ConfigData> {
  return Config.create(map, schema, overrides);
}
