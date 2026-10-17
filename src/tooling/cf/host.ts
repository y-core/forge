import { v } from "../../validation/mod";
import { loadConfigModule } from "../cli/config-module";
import { CliError } from "../cli/errors";
import type { CfHostConfig } from "./types";

/** Where `forge cf sync` looks for an application's optional host config. @internal */
export const DEFAULT_CF_CONFIG = "config/cf.ts";

const PlacementSchema = v.strictObject({
  jurisdiction: v.optional(v.picklist(["eu", "fedramp", "us"])),
  location: v.optional(v.picklist(["wnam", "enam", "weur", "eeur", "apac", "oc"])),
  readReplication: v.optional(v.picklist(["auto", "disabled"])),
  preview: v.optional(v.boolean()),
});

/** The shape `config/cf.ts` must export, held at the boundary so a misspelt key is refused by name. @internal */
export const CfHostConfigSchema = v.strictObject({ d1: v.optional(v.record(v.string(), PlacementSchema)) });

/** The host config `config/cf.ts` exports, held to `CfHostConfigSchema`; `{}` where the app declares none. @internal */
export async function loadCfHostConfig(root: string): Promise<CfHostConfig> {
  const loaded = (await loadConfigModule<unknown>({ root, path: DEFAULT_CF_CONFIG, explicit: false, what: "cf host config" }))?.value ?? {};
  const result = v.safeParse(CfHostConfigSchema, loaded);
  if (result.success) return loaded as CfHostConfig;
  const detail = result.issues.map((issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`).join("; ");
  throw new CliError("invalid-args", `${DEFAULT_CF_CONFIG}: ${detail}`);
}
