import type { v } from "../validation/validation";

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
