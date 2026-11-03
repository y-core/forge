import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createCommand } from "../../cli/command";
import { loadConfigModule } from "../../cli/config-module";
import { scopeLogger } from "../../cli/log";
import { captureStreams, shellQuote } from "../../cli/proc";
import type { CommandBase, SpawnSync } from "../../cli/types";
import { loadWranglerConfig } from "../config/parse";
import { collectBindings, collectNamedEnvVars, collectPolicyVars, collectSecretNames, collectVars, emit } from "./cf-env-gen";
import { DEFAULT_OPTIONS } from "./cf-env-registry";
import type { Entry, GenOptions } from "./types";

const GEN_ENV_FLAGS = {
  wrangler: { type: "string", default: "wrangler.jsonc", description: "Path to wrangler.jsonc" },
  "dev-vars": { type: "string", default: ".dev.vars", description: "Path to .dev.vars" },
  out: { type: "string", default: "src/app/env.schema.ts", description: "Output module path" },
  config: { type: "string", default: "config/env.config.ts", description: "Host-policy module default-exporting defineEnvConfig({...})" },
} as const;

type GenEnvFlags = Readonly<Record<keyof typeof GEN_ENV_FLAGS, string>>;

/** The flag values a bare `forge cf gen env` runs with. @internal */
export function defaultEnvFlags(): Record<keyof typeof GEN_ENV_FLAGS, string> {
  return {
    wrangler: GEN_ENV_FLAGS.wrangler.default,
    "dev-vars": GEN_ENV_FLAGS["dev-vars"].default,
    out: GEN_ENV_FLAGS.out.default,
    config: GEN_ENV_FLAGS.config.default,
  };
}

/** Loads a `--config` module's `Partial<GenOptions>` merged over `DEFAULT_OPTIONS`, or the defaults when no path is given. @public */
export async function loadOptions(root: string, configPath?: string): Promise<GenOptions> {
  if (!configPath) return DEFAULT_OPTIONS;
  const loaded = await loadConfigModule<Partial<GenOptions>>({ root, path: configPath, explicit: true, what: "env config" });
  return { ...DEFAULT_OPTIONS, ...loaded?.value };
}

/** Types the default export of a `config/env.config.ts`. @public */
export function defineEnvConfig(config: Partial<GenOptions>): Partial<GenOptions> {
  return config;
}

/** The `forge cf gen env` invocation that rewrites the same module: every flag given a value other than its default, in declaration order. @internal */
export function regenerateCommand(flags: GenEnvFlags): string {
  const given = Object.entries(GEN_ENV_FLAGS).filter(([name, flag]) => flags[name as keyof typeof GEN_ENV_FLAGS] !== flag.default);
  const word = (value: string) => (/^[A-Za-z0-9_./-]+$/.test(value) ? value : shellQuote(value));
  return ["forge cf gen env", ...given.map(([name]) => `--${name} ${word(flags[name as keyof typeof GEN_ENV_FLAGS])}`)].join(" ");
}

function formatSchema(text: string, outPath: string, root: string, spawn?: SpawnSync): string | undefined {
  const result = captureStreams(process.execPath, ["fmt", "--no-script", "--stdin-filepath", outPath], { cwd: root, input: text }, spawn);
  return result.code === 0 && result.exited ? result.stdout : undefined;
}

/** Renders the env-schema module `forge cf gen env` writes under `root`, formatted unless `bun fmt` failed. @internal */
export async function renderEnvSchema(
  root: string,
  flags: GenEnvFlags,
  spawn?: SpawnSync,
): Promise<{ text: string; entries: Entry[]; formatted: boolean; configured: boolean }> {
  const cfg = loadWranglerConfig(resolve(root, flags.wrangler)).config;
  const devVarsPath = resolve(root, flags["dev-vars"]);
  const devVars = existsSync(devVarsPath) ? readFileSync(devVarsPath, "utf-8") : "";

  const configPath = resolve(root, flags.config);
  const configured = existsSync(configPath);
  const options = await loadOptions(root, configured ? configPath : undefined);

  const declared = [...collectBindings(cfg, options), ...collectVars(collectSecretNames(cfg, devVars), cfg.vars ?? {}, options)];
  const named = [...declared, ...collectNamedEnvVars(cfg, new Set(declared.map((entry) => entry.name)), options)];
  const entries = [...named, ...collectPolicyVars(new Set(named.map((entry) => entry.name)), options)];
  const raw = emit(entries, regenerateCommand(flags));
  const formatted = formatSchema(raw, resolve(root, flags.out), root, spawn);
  return { text: formatted ?? raw, entries, formatted: formatted !== undefined, configured };
}

/** Builds the env-schema generator command: read wrangler+dev-vars → collect → emit → format. @public */
export function createGenEnvCommand(spawn?: SpawnSync): CommandBase {
  const log = scopeLogger("cf gen env");

  return createCommand({
    name: "env",
    description: "Generate an env-schema module from wrangler.jsonc bindings and .dev.vars keys",
    flags: GEN_ENV_FLAGS,
    args: { kind: "none" },
    async run(_args, flags) {
      const root = process.cwd();
      const outPath = resolve(root, flags.out);
      const { text, entries, formatted, configured } = await renderEnvSchema(root, flags, spawn);
      if (!configured) log.info(`no config at ${flags.config}; using built-in defaults`);
      writeFileSync(outPath, text);
      if (!formatted) log.warn(`bun fmt failed; ${outPath} is unformatted`);

      log.info(`wrote ${entries.length} entries to ${outPath}`);
    },
  });
}
