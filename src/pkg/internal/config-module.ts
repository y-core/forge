import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Where a bin looks for its configuration module, and what to call it when it is wrong. */
export interface ConfigModuleRequest {
  /** Directory a relative `path` resolves against. */
  root: string;
  /** Module path, absolute or relative to `root`. */
  path: string;
  /** Whether the caller named `path` rather than falling back to the default. */
  explicit: boolean;
  /** What the module holds, named in every error — e.g. `"step table"`. */
  what: string;
}

/** Imports a config module's default export. Returns `undefined` only when an unnamed default path
 *  is absent, so a typo in an explicit `--config` is an error rather than a silent fallback. */
export async function loadConfigModule<T>(request: ConfigModuleRequest): Promise<T | undefined> {
  const { root, path, explicit, what } = request;
  // `resolve` returns `path` unchanged when it is already absolute, so both forms are covered.
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
