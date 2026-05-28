import type { Config } from "./config";

const registry = new WeakMap<object, unknown>();

export function registerConfig(target: object, store: unknown): void {
  registry.set(target, store);
}

export function retrieveConfig<T>(target: object): Config<T> | undefined {
  return registry.get(target) as Config<T> | undefined;
}
