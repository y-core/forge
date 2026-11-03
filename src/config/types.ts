import type { v } from "../validation/validation";

/** Extracts the resolved `Config` data type from an app env, or `undefined` when absent. @public */
export type InferConfig<E> = E extends { Config: infer C } ? C : undefined;

/** Bare variable record set by the route config injector. Intersect into `AppEnv.Variables`. @public */
export type ConfigContext<C> = { config: C };

/** Reference to a named env var, produced by {@link env} and resolved during mapping. @public */
export type EnvRef<K extends string = string> = { readonly __env: K };

/** A config mapping node: a literal string, an {@link EnvRef}, or a nested record of mappings. @public */
export type EnvMapping<K extends string = string> = string | EnvRef<K> | { readonly [key: string]: EnvMapping<K>; readonly __env?: never };

/** The Worker's env surface, which the module `forge cf gen env` writes merges into, so `createConfig` refuses an undeclared `env()` name. @public */
export interface DeclaredEnv extends Record<never, never> {}

/** The names of `E`'s vars and secrets, never its bindings, or any string when `E` declares nothing. @internal */
export type EnvVarName<E> = [keyof E] extends [never]
  ? string
  : Extract<{ [K in keyof E]-?: NonNullable<E[K]> extends string | number | boolean ? K : never }[keyof E], string>;

/** A name `env()` may reference in a config mapping: a var or secret of {@link DeclaredEnv}, or any string while nothing declares one. @public */
export type DeclaredEnvName = EnvVarName<DeclaredEnv>;

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
