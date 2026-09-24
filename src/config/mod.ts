export type { ConfigContext, ConfigDescriptor, ConfigOverrides, EnvMapping, EnvRef, InferConfig } from "./types";
export { Config, createConfig, env, optionalGroup, requiredGroup, resolveConfig } from "./config";
export { registerConfig, retrieveConfig } from "./registry";
