/** cf-env-command.ts — the runnable env-schema generator.
 *
 *  A forge CLI command wrapping the pure `cf-env-gen` core with the host-facing concerns:
 *  file IO, sensible path defaults overridable per-flag, a `--config` policy module, and a
 *  biome format pass. Exposed both as the `@y-core/forge/validation/cli` API (`createGenEnv`)
 *  and as the `forge-cfgen` bin — a consumer wires either `execute(createGenEnv())` or a
 *  `"gen:env": "forge-cfgen"` package.json script, plus an optional `--config` module.
 *
 *  Flags (all optional; paths resolve relative to the current working directory):
 *    --wrangler  path to wrangler.jsonc      (default `wrangler.jsonc`)
 *    --dev-vars  path to .dev.vars           (default `.dev.vars`)
 *    --out       output module path          (default `src/app/env.schema.ts`)
 *    --config    host-policy module path     (default `src/app/env.config.ts`; when that
 *                file is absent the built-in `DEFAULT_OPTIONS` are used)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCommand } from "../../cli/command";
import { scopeLogger } from "../../cli/log";
import type { CommandBase } from "../../cli/types";
import { collectBindings, collectVars, DEFAULT_OPTIONS, emit, type GenOptions, stripJsonc } from "./cf-env-gen";

/** Parse a `wrangler.jsonc` file at `path` into a config object. @public */
export function readWranglerConfig(path: string): Record<string, unknown> {
  const raw = stripJsonc(readFileSync(path, "utf-8")).replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Load host policy from a `--config` module — a `Partial<GenOptions>` exported as `options`
 *  (or default) — merged over `DEFAULT_OPTIONS`. Returns the defaults when no path is given. @public */
export async function loadOptions(configPath?: string): Promise<GenOptions> {
  if (!configPath) return DEFAULT_OPTIONS;
  const mod = (await import(pathToFileURL(configPath).href)) as { options?: Partial<GenOptions>; default?: Partial<GenOptions> };
  return { ...DEFAULT_OPTIONS, ...(mod.options ?? mod.default ?? {}) };
}

/** Format `outPath` through biome so the generated module passes the lint gate. */
function formatWithBiome(outPath: string, cwd: string): void {
  const biome = spawnSync("biome", ["check", "--write", outPath], { stdio: "inherit", cwd });
  if (biome.status !== 0 && biome.error) {
    // Fall back to the locally-installed binary when biome is not on PATH.
    spawnSync(resolve(cwd, "node_modules/.bin/biome"), ["check", "--write", outPath], { stdio: "inherit", cwd });
  }
}

/** Build the env-schema generator command: read wrangler+dev-vars → collect → emit → format.
 *  Returns the variance-safe `CommandBase` (the form `execute` accepts); the typed `run`
 *  handler is recovered internally by `execute`. @public */
export function createGenEnv(): CommandBase {
  const log = scopeLogger("gen-env");

  return createCommand({
    name: "gen-env",
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

      // The config file is optional: use it when present, else fall back to DEFAULT_OPTIONS.
      const configPath = resolve(cwd, flags.config);
      const hasConfig = existsSync(configPath);
      if (!hasConfig) log.info(`no config at ${flags.config}; using built-in defaults`);
      const options = await loadOptions(hasConfig ? configPath : undefined);

      const entries = [...collectBindings(cfg, options), ...collectVars(devVars, wranglerVars, options)];
      writeFileSync(outPath, emit(entries));
      formatWithBiome(outPath, cwd);

      log.info(`wrote ${entries.length} entries to ${outPath}`);
    },
  });
}
