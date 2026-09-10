export type { ConfigContext, ConfigDescriptor, ConfigOverrides, EnvMapping, EnvRef, InferConfig } from "./types";
export { Config, createConfig, env, optionalGroup, resolveConfig } from "./config";
export { registerConfig, retrieveConfig } from "./registry";
