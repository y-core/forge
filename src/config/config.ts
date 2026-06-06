import { v } from "../validation/validation";

export type InferConfig<E> = E extends { Config: infer C } ? C : undefined;

/** Bare variable record set by the route config injector. Intersect into `AppEnv.Variables`. @public */
export type ConfigContext<C> = { config: C };

export type EnvRef<K extends string = string> = { readonly __env: K };

export type EnvMapping<K extends string = string> = string | EnvRef<K> | { [key: string]: EnvMapping<K> };

export interface ConfigOverrides<ConfigData> {
  detect: (env: Record<string, unknown>) => boolean;
  patch: (config: ConfigData) => ConfigData;
}

export interface ConfigDescriptor<ConfigData, Keys extends string = string> {
  map: EnvMapping<Keys>;
  schema: v.BaseSchema<unknown, ConfigData, v.BaseIssue<unknown>>;
  overrides?: ConfigOverrides<ConfigData>;
}

function resolve<ConfigData>(env: object, descriptor: ConfigDescriptor<ConfigData>): ConfigData {
  const record = env as Record<string, unknown>;
  const mapped = applyMapping(record, descriptor.map);
  const result = v.safeParse(descriptor.schema, mapped);
  if (!result.success) {
    const issues = result.issues.map((issue) => `${issue.path?.map((p) => p.key).join(".") ?? "root"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  let config = result.output;
  if (descriptor.overrides?.detect(record)) {
    config = descriptor.overrides.patch(config);
  }
  return config;
}

export function env<K extends string>(name: K): EnvRef<K> {
  return { __env: name };
}

export function applyMapping(env: Record<string, unknown>, map: EnvMapping): unknown {
  if (typeof map === "string") return map;
  if ("__env" in map) return env[(map as EnvRef).__env];
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map)) {
    result[key] = applyMapping(env, value);
  }
  return result;
}

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
        if (!input[key]) return null;
      }
      const result: Record<string, unknown> = { ...input };
      for (const [key, defaultVal] of Object.entries(defaults)) {
        if (!result[key]) result[key] = defaultVal;
      }
      return result as Output;
    }),
  );
}

/** Returns config from store, or an empty object cast to T when no store is registered. @public */
export function resolveConfig<T>(store: Config<T> | undefined, env: object): T {
  return (store ? store.get(env) : {}) as T;
}

/** Lazy singleton config holder. Resolves once on first get(); seed()/reset() for test control. @public */
export class Config<ConfigData> {
  #value: ConfigData | undefined;
  readonly #resolve: (env: object) => ConfigData;

  constructor(map: EnvMapping, schema: v.BaseSchema<unknown, ConfigData, v.BaseIssue<unknown>>, overrides?: ConfigOverrides<ConfigData>) {
    const descriptor: ConfigDescriptor<ConfigData> = { map, schema, ...(overrides ? { overrides } : {}) };
    this.#resolve = (env: object) => resolve(env, descriptor);
  }

  /**
   * Resolves config on first call and caches it for the lifetime of the holder.
   *
   * @remarks
   * The cache lives as long as the V8 isolate, not a single request. The `env` passed on the
   * *first* call wins; later calls ignore their `env` and return the cached value. This is correct
   * on Workers (bindings are stable per isolate) but means tests that vary `env` must `reset()`
   * (or `seed()`) between cases to avoid leaking the first resolution.
   */
  get(env: object): ConfigData {
    this.#value ??= this.#resolve(env);
    return this.#value;
  }

  seed(config: ConfigData): void {
    this.#value = config;
  }

  reset(): void {
    this.#value = undefined;
  }
}
