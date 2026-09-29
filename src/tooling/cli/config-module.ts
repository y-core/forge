import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ConfigModuleRequest, LoadedConfigModule } from "./types";

/** Imports a config module with its default export, or `undefined` when a non-explicit default path is absent. */
export async function loadConfigModule<T>(request: ConfigModuleRequest): Promise<LoadedConfigModule<T> | undefined> {
  const { root, path, explicit, what } = request;
  const resolved = resolve(root, path);

  if (!existsSync(resolved)) {
    if (explicit) throw new Error(`No ${what} at \`${path}\` — --config names a module that does not exist.`);
    return undefined;
  }

  const module = (await import(pathToFileURL(resolved).href)) as Readonly<Record<string, unknown>> & { default?: T };
  if (module.default === undefined) {
    throw new Error(`\`${path}\` has no default export — a ${what} module must \`export default\` the value it holds.`);
  }
  return { value: module.default, exports: module };
}
