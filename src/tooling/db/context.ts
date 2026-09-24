import { resolve } from "node:path";
import process from "node:process";

import { v } from "../../validation/mod";
import { loadConfigModule } from "../cli/config-module";
import { CliError } from "../cli/errors";
import type { CliContext } from "../cli/types";
import { PLAIN } from "../term/color";
import { resolveDbConfig } from "./config";
import { resolveHome } from "./home";
import { realDbIo } from "./io";
import { DbHostConfigSchema } from "./types";
import type { DbContextOverrides, DbHostConfig, DbRunContext, SharedDbFlags } from "./types";

/** Where `forge db` looks for an application's optional host config. @internal */
export const DEFAULT_DB_CONFIG = "config/db.ts";

/** The flags every `forge db` verb declares, spelled once. @internal */
export const sharedDbFlags = {
  target: {
    type: "string" as const,
    short: "t",
    description: "Which database: place[:database], place being local, standby, remote or preview",
    default: "local",
  },
  db: { type: "string" as const, description: "The d1_databases binding or database_name, when the config declares more than one" },
  config: { type: "string" as const, short: "c", description: "Path to wrangler.jsonc", default: "wrangler.jsonc" },
  env: { type: "string" as const, short: "e", description: "Wrangler environment, forwarded as `wrangler -e`" },
  root: { type: "string" as const, description: "Application root. Defaults to the current directory" },
  json: { type: "boolean" as const, description: "Print the result as a JSON document instead of a report. The only thing written to stdout" },
  yes: { type: "boolean" as const, description: "Skip the confirmation a destructive verb asks. Required in a non-interactive run" },
};

/** The host config `config/db.ts` exports, held to `DbHostConfigSchema` and refused by field. */
async function loadHostConfig(root: string): Promise<DbHostConfig> {
  const loaded = (await loadConfigModule<unknown>({ root, path: DEFAULT_DB_CONFIG, explicit: false, what: "db host config" })) ?? {};
  const result = v.safeParse(DbHostConfigSchema, loaded);
  if (result.success) return loaded as DbHostConfig;
  const detail = result.issues.map((issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`).join("; ");
  throw new CliError("invalid-args", `${DEFAULT_DB_CONFIG}: ${detail}`);
}

/** Resolves the shared flags into a run context. @public */
export async function resolveDbContext(flags: SharedDbFlags, ctx?: CliContext, overrides: DbContextOverrides = {}): Promise<DbRunContext> {
  const root = resolve(flags.root ?? process.cwd());
  const json = Boolean(flags.json);
  const print = (line: string) => (ctx?.io.stdout ?? console.log)(line);
  const io = overrides.io ?? realDbIo(root, (line) => (ctx?.io.stderr ?? console.error)(line));
  const config = resolveDbConfig({ root, config: flags.config, db: flags.db, env: flags.env, target: flags.target });
  const home = resolveHome(config, io);
  const host = overrides.host ?? (await loadHostConfig(root));
  return { config, home, io, host, json, yes: Boolean(flags.yes), style: json ? PLAIN : (ctx?.out ?? PLAIN), print };
}

/** The lifetime of one `forge db` verb: every handle it opened over local state is released before it returns, since an open one keeps a workerd process alive and the process would never exit. @public */
export async function withDbRun<T>(
  flags: SharedDbFlags,
  ctx: CliContext | undefined,
  overrides: DbContextOverrides,
  body: (run: DbRunContext) => Promise<T>,
): Promise<T> {
  const run = await resolveDbContext(flags, ctx, overrides);
  try {
    return await body(run);
  } finally {
    await run.io.closeD1(null);
  }
}

/** Where a confirmation prints: stderr under `--json`, so stdout stays the one JSON document, and stdout otherwise. @public */
export function confirmPrinter(run: DbRunContext): (line: string) => void {
  return run.json ? (line) => run.io.log(line) : run.print;
}
