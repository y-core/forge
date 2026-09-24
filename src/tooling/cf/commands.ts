import { addCommand, createCommand } from "../cli/command";
import type { CliContext, CommandBase } from "../cli/types";
import { createSyncAccountCommand, runSyncAccount, SYNC_ACCOUNT_DESCRIPTION, syncAccountFlags } from "./account/commands";
import { createGenEnvCommand } from "./gen/cf-env-command";
import { createSyncZoneCommand } from "./zone/commands";

type LooseFlags = Record<string, string | string[] | boolean | undefined>;

/** The `forge cf` command tree: everything that talks to Cloudflare, under one noun. @public */
export function createCfCommands(): CommandBase {
  const cf = createCommand({
    name: "cf",
    description: "Reconcile and generate against Cloudflare — account bindings, zone rules, and the env schema",
  });

  // The bare `cf sync` is `cf sync account`, built from the same flags and runner rather than a
  // second copy.
  const sync = createCommand({
    name: "sync",
    description: `${SYNC_ACCOUNT_DESCRIPTION}. Defaults to the account scope; name a scope to be explicit`,
    flags: syncAccountFlags,
    run: (_args, flags, ctx?: CliContext) => runSyncAccount(flags as LooseFlags, ctx),
  });
  addCommand(sync, createSyncAccountCommand());
  addCommand(sync, createSyncZoneCommand());
  addCommand(cf, sync);

  const gen = createCommand({ name: "gen", description: "Generate a typed module from Cloudflare configuration" });
  addCommand(gen, createGenEnvCommand());
  addCommand(cf, gen);

  return cf;
}
