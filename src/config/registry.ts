import type { Config } from "./config";

const registry = new WeakMap<object, unknown>();

/** Associates a `Config` store with a host object via a `WeakMap`, with no shared import. @public */
export function registerConfig(target: object, store: unknown): void {
  registry.set(target, store);
}

/** Retrieves the `Config` store previously associated with `target` by `registerConfig`. @public */
export function retrieveConfig<T>(target: object): Config<T> | undefined {
  return registry.get(target) as Config<T> | undefined;
}
