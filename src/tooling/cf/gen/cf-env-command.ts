import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createCommand } from "../../cli/command";
import { loadConfigModule } from "../../cli/config-module";
import { scopeLogger } from "../../cli/log";
import { runUnchecked } from "../../cli/proc";
import type { CommandBase, SpawnSync } from "../../cli/types";
import { loadWranglerConfig } from "../config/parse";
import { collectBindings, collectVars, emit } from "./cf-env-gen";
import { DEFAULT_OPTIONS } from "./cf-env-registry";
import type { GenOptions } from "./types";

/** Loads a `--config` module's `Partial<GenOptions>` merged over `DEFAULT_OPTIONS`, or the defaults when no path is given. @public */
export async function loadOptions(configPath?: string): Promise<GenOptions> {
  if (!configPath) return DEFAULT_OPTIONS;
  const loaded = await loadConfigModule<Partial<GenOptions>>({ root: process.cwd(), path: configPath, explicit: true, what: "env config" });
  return { ...DEFAULT_OPTIONS, ...loaded?.value };
}

/** Types the default export of a `config/env.config.ts`. @public */
export function defineEnvConfig(config: Partial<GenOptions>): Partial<GenOptions> {
  return config;
}

function formatGenerated(outPath: string, cwd: string, spawn?: SpawnSync): boolean {
  return runUnchecked(process.execPath, ["fmt", "--no-script", outPath], { cwd }, spawn).code === 0;
}

/** Builds the env-schema generator command: read wrangler+dev-vars → collect → emit → format. @public */
export function createGenEnvCommand(spawn?: SpawnSync): CommandBase {
  const log = scopeLogger("cf gen env");

  return createCommand({
    name: "env",
    description: "Generate an env-schema module from wrangler.jsonc bindings and .dev.vars keys",
    flags: {
      wrangler: { type: "string", default: "wrangler.jsonc", description: "Path to wrangler.jsonc" },
      "dev-vars": { type: "string", default: ".dev.vars", description: "Path to .dev.vars" },
      out: { type: "string", default: "src/app/env.schema.ts", description: "Output module path" },
      config: { type: "string", default: "config/env.config.ts", description: "Host-policy module default-exporting defineEnvConfig({...})" },
    },
    args: { kind: "none" },
    async run(_args, flags) {
      const cwd = process.cwd();
      const outPath = resolve(cwd, flags.out);

      const cfg = loadWranglerConfig(resolve(cwd, flags.wrangler)).config;
      const devVarsPath = resolve(cwd, flags["dev-vars"]);
      const devVars = existsSync(devVarsPath) ? readFileSync(devVarsPath, "utf-8") : "";
      const wranglerVars = cfg.vars ?? {};

      const configPath = resolve(cwd, flags.config);
      const hasConfig = existsSync(configPath);
      if (!hasConfig) log.info(`no config at ${flags.config}; using built-in defaults`);
      const options = await loadOptions(hasConfig ? configPath : undefined);

      const entries = [...collectBindings(cfg, options), ...collectVars(devVars, wranglerVars, options)];
      writeFileSync(outPath, emit(entries));
      if (!formatGenerated(outPath, cwd, spawn)) log.warn(`bun fmt failed; ${outPath} is unformatted`);

      log.info(`wrote ${entries.length} entries to ${outPath}`);
    },
  });
}
