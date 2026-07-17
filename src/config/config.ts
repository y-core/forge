import { parseEnv } from "../validation/parse-env";
import { v } from "../validation/validation";

/** Extracts the resolved `Config` data type from an app env, or `undefined` when absent. @public */
export type InferConfig<E> = E extends { Config: infer C } ? C : undefined;

/** Bare variable record set by the route config injector. Intersect into `AppEnv.Variables`. @public */
export type ConfigContext<C> = { config: C };

/** Reference to a named env var, produced by {@link env} and resolved during mapping. @public */
export type EnvRef<K extends string = string> = { readonly __env: K };

/** A config mapping node: a literal string, an {@link EnvRef}, or a nested record of mappings. @public */
export type EnvMapping<K extends string = string> = string | EnvRef<K> | { [key: string]: EnvMapping<K> };

/** Environment-conditional config override: `detect` selects, `patch` mutates the parsed config. @public */
export interface ConfigOverrides<ConfigData> {
  detect: (env: Record<string, unknown>) => boolean;
  patch: (config: ConfigData) => ConfigData;
}

/** Describes how to build a config: env mapping, validation schema, and optional overrides. @public */
export interface ConfigDescriptor<ConfigData, Keys extends string = string> {
  map: EnvMapping<Keys>;
  schema: v.BaseSchema<unknown, ConfigData, v.BaseIssue<unknown>>;
  overrides?: ConfigOverrides<ConfigData>;
}

function resolve<ConfigData>(env: object, descriptor: ConfigDescriptor<ConfigData>): ConfigData {
  const record = env as Record<string, unknown>;
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
export function applyMapping(env: Record<string, unknown>, map: EnvMapping): unknown {
  if (typeof map === "string") return map;
  if ("__env" in map) return env[(map as EnvRef).__env];
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map)) {
    result[key] = applyMapping(env, value);
  }
  return result;
}

/** Builds a schema for an optional config group that resolves to `null` when required keys are absent. @public */
export function optionalGroup<T extends Record<string, v.GenericSchema>>(
  entries: T,
  options: { required: (keyof T & string)[] | "all"; defaults?: Partial<Record<keyof T & string, unknown>> },
) {
  type Output = { [K in keyof T]: v.InferOutput<T[K]> } | null;

  const requiredKeys = options.required === "all" ? Object.keys(entries) : options.required;
  const defaults = options.defaults ?? {};

  return v.pipe(
    v.unknown(),
    v.transform((raw: unknown): Output => {
      const input = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      for (const key of requiredKeys) {
        if (input[key] == null) return null;
      }
      const result: Record<string, unknown> = { ...input };
      for (const [key, defaultVal] of Object.entries(defaults)) {
        if (result[key] == null) result[key] = defaultVal;
      }
      return result as Output;
    }),
  );
}

/** Returns config from store, or an empty object cast to T when no store is registered. @public */
export function resolveConfig<T>(store: Config<T> | undefined, env: object): T {
  return (store ? store.get(env) : {}) as T;
}

/** Lazy config holder. Resolves and caches parsed config per distinct `env`; seed()/reset() for test control. @public */
export class Config<ConfigData> {
  #cache = new WeakMap<object, ConfigData>();
  #seed: ConfigData | undefined;
  #hasSeed = false;
  readonly #resolve: (env: object) => ConfigData;

  private constructor(map: EnvMapping, schema: v.BaseSchema<unknown, ConfigData, v.BaseIssue<unknown>>, overrides?: ConfigOverrides<ConfigData>) {
    const descriptor: ConfigDescriptor<ConfigData> = { map, schema, ...(overrides ? { overrides } : {}) };
    this.#resolve = (env: object) => resolve(env, descriptor);
  }

  /** Instantiates a holder. Use the {@link createConfig} factory; the constructor is private. @internal */
  static create<ConfigData>(
    map: EnvMapping,
    schema: v.BaseSchema<unknown, ConfigData, v.BaseIssue<unknown>>,
    overrides?: ConfigOverrides<ConfigData>,
  ): Config<ConfigData> {
    return new Config(map, schema, overrides);
  }

  /** Resolves config for `env`, caching the parsed result per distinct `env` object. */
  get(env: object): ConfigData {
    if (this.#hasSeed) return this.#seed as ConfigData;
    const hit = this.#cache.get(env);
    if (hit) return hit;
    const resolved = this.#resolve(env);
    this.#cache.set(env, resolved);
    return resolved;
  }

  /** Seeds a fixed config returned by every get(), bypassing resolution (whole-holder override). */
  seed(config: ConfigData): void {
    this.#seed = config;
    this.#hasSeed = true;
  }

  /** Clears the seed and the per-env cache, forcing re-resolution on the next get(). */
  reset(): void {
    this.#seed = undefined;
    this.#hasSeed = false;
    this.#cache = new WeakMap<object, ConfigData>();
  }
}

/** Creates a lazy config holder that resolves and caches parsed config per distinct `env` object. @public */
export function createConfig<ConfigData>(
  map: EnvMapping,
  schema: v.BaseSchema<unknown, ConfigData, v.BaseIssue<unknown>>,
  overrides?: ConfigOverrides<ConfigData>,
): Config<ConfigData> {
  return Config.create(map, schema, overrides);
}
