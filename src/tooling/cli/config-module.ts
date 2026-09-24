import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ConfigModuleRequest } from "./types";

/** Imports a config module's default export, or `undefined` when a non-explicit default path is absent. */
export async function loadConfigModule<T>(request: ConfigModuleRequest): Promise<T | undefined> {
  const { root, path, explicit, what } = request;
  const resolved = resolve(root, path);

  if (!existsSync(resolved)) {
    if (explicit) throw new Error(`No ${what} at \`${path}\` — --config names a module that does not exist.`);
    return undefined;
  }

  const module = (await import(pathToFileURL(resolved).href)) as { default?: T };
  if (module.default === undefined) {
    throw new Error(`\`${path}\` has no default export — a ${what} module must \`export default\` the value it holds.`);
  }
  return module.default;
}
