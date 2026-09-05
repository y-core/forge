import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createCommand } from "../../cli/command";
import { stripJsonc } from "../../cli/jsonc";
import { scopeLogger } from "../../cli/log";
import type { CommandBase } from "../../cli/types";
import { collectBindings, collectVars, emit } from "./cf-env-gen";
import { DEFAULT_OPTIONS, type GenOptions } from "./cf-env-registry";

/** Parse a `wrangler.jsonc` file at `path` into a config object. @public */
export function readWranglerConfig(path: string): Record<string, unknown> {
  return JSON.parse(stripJsonc(readFileSync(path, "utf-8"))) as Record<string, unknown>;
}

/** Loads a `--config` module's `Partial<GenOptions>` merged over `DEFAULT_OPTIONS`, or the defaults when no path is given. @public */
export async function loadOptions(configPath?: string): Promise<GenOptions> {
  if (!configPath) return DEFAULT_OPTIONS;
  const mod = (await import(pathToFileURL(configPath).href)) as { options?: Partial<GenOptions>; default?: Partial<GenOptions> };
  return { ...DEFAULT_OPTIONS, ...(mod.options ?? mod.default) };
}

function formatGenerated(outPath: string, cwd: string): boolean {
  const oxfmt = spawnSync("oxfmt", [outPath], { stdio: "inherit", cwd });
  if (oxfmt.status === 0) return true;
  const local = spawnSync(resolve(cwd, "node_modules/.bin/oxfmt"), [outPath], { stdio: "inherit", cwd });
  return local.status === 0;
}

/** Builds the env-schema generator command: read wrangler+dev-vars → collect → emit → format. @public */
export function createGenEnvCommand(): CommandBase {
  const log = scopeLogger("cf gen env");

  return createCommand({
    name: "env",
    description: "Generate an env-schema module from wrangler.jsonc bindings and .dev.vars keys",
    flags: {
      wrangler: { type: "string", default: "wrangler.jsonc", description: "Path to wrangler.jsonc" },
      "dev-vars": { type: "string", default: ".dev.vars", description: "Path to .dev.vars" },
      out: { type: "string", default: "src/app/env.schema.ts", description: "Output module path" },
      config: { type: "string", default: "src/app/env.config.ts", description: "Host-policy module exporting a Partial<GenOptions>" },
    },
    args: { kind: "none" },
    async run(_args, flags) {
      const cwd = process.cwd();
      const outPath = resolve(cwd, flags.out);

      const cfg = readWranglerConfig(resolve(cwd, flags.wrangler));
      const devVarsPath = resolve(cwd, flags["dev-vars"]);
      const devVars = existsSync(devVarsPath) ? readFileSync(devVarsPath, "utf-8") : "";
      const wranglerVars = (cfg.vars as Record<string, unknown> | undefined) ?? {};

      const configPath = resolve(cwd, flags.config);
      const hasConfig = existsSync(configPath);
      if (!hasConfig) log.info(`no config at ${flags.config}; using built-in defaults`);
      const options = await loadOptions(hasConfig ? configPath : undefined);

      const entries = [...collectBindings(cfg, options), ...collectVars(devVars, wranglerVars, options)];
      writeFileSync(outPath, emit(entries));
      if (!formatGenerated(outPath, cwd)) log.warn(`oxfmt failed; ${outPath} is unformatted`);

      log.info(`wrote ${entries.length} entries to ${outPath}`);
    },
  });
}
