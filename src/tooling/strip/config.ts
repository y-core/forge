import { v } from "../../validation/mod";
import { loadConfigModule } from "../cli/config-module";
import { CliError } from "../cli/errors";
import type { StripConfig } from "./types";
import { StripConfigSchema } from "./types";

/** Where `forge strip` looks for its manifest when `--config` names none. @public */
export const DEFAULT_STRIP_CONFIG = "config/strip.ts";

/** Types the default export of a `config/strip.ts`. @public */
export function defineStripConfig(config: StripConfig): StripConfig {
  return config;
}

/** Imports the strip manifest and holds it to `StripConfigSchema`, refusing it by field. @public */
export async function loadStripConfig(options: { root: string; path?: string }): Promise<StripConfig> {
  const path = options.path ?? DEFAULT_STRIP_CONFIG;
  const loaded = await loadConfigModule<unknown>({ root: options.root, path, explicit: options.path !== undefined, what: "strip manifest" });
  if (loaded === undefined) {
    throw new CliError("invalid-args", `No strip manifest at \`${path}\` — forge strip needs one, default-exporting defineStripConfig({...})`);
  }
  const result = v.safeParse(StripConfigSchema, loaded);
  if (result.success) return result.output;
  const detail = result.issues.map((issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`).join("; ");
  throw new CliError("invalid-args", `${path}: ${detail}`);
}
