import { v } from "../../validation/mod";
import { loadConfigModule } from "../cli/config-module";
import { CliError } from "../cli/errors";
import type { FeatureManifest } from "./types";
import { FeatureManifestSchema } from "./types";

/** Where `forge curate` looks for its manifest when `--config` names none. @public */
export const DEFAULT_FEATURE_MANIFEST = "config/features.ts";

/** Types the default export of a `config/features.ts`. @public */
export function defineFeatures(config: FeatureManifest): FeatureManifest {
  return config;
}

/** Imports the feature manifest and holds it to `FeatureManifestSchema`, refusing it by field. @public */
export async function loadFeatures(options: { root: string; path?: string }): Promise<FeatureManifest> {
  const path = options.path ?? DEFAULT_FEATURE_MANIFEST;
  const loaded = await loadConfigModule<unknown>({ root: options.root, path, explicit: options.path !== undefined, what: "feature manifest" });
  if (loaded === undefined) {
    throw new CliError("invalid-args", `No feature manifest at \`${path}\` — forge curate needs one, default-exporting defineFeatures({...})`);
  }
  const result = v.safeParse(FeatureManifestSchema, loaded);
  if (result.success) return result.output;
  const detail = result.issues.map((issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`).join("; ");
  throw new CliError("invalid-args", `${path}: ${detail}`);
}
