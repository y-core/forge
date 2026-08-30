import { addCommand, createCommand } from "../core/command";
import type { CliContext, CommandBase } from "../core/types";
import { createSyncAccountCommand, runSyncAccount, SYNC_ACCOUNT_DESCRIPTION, syncAccountFlags } from "./account/commands";
import { createGenEnvCommand } from "./gen/cf-env-command";
import { createSyncZoneCommand } from "./zone/commands";

type LooseFlags = Record<string, string | string[] | boolean | undefined>;

/**
 * The `forge cf` tree: everything that talks to Cloudflare, under one noun.
 *
 * The grammar is `cf · verb · object`, and the object is always nameable. `verify`, `release` and
 * `assets` stay at the top level because they act on the repository rather than on the platform —
 * a bare verb takes the repo as its object, a noun opens a domain where the verb and object are
 * both spelled out.
 *
 * **`account` and `zone` are Cloudflare's own scopes**, not names invented here. They are the axis
 * the API paths divide on (`/accounts/{id}` versus `/zones/{id}`) and the axis API-token
 * permissions divide on, so a reader who learns the CLI has learned the thing they need anyway.
 *
 * @public
 */
export function createCfCommands(): CommandBase {
  const cf = createCommand({
    name: "cf",
    description: "Reconcile and generate against Cloudflare — account bindings, zone rules, and the env schema",
  });

  // The bare `cf sync` is `cf sync account`, built from the same flags and the same runner rather
  // than a second copy that agrees until one is edited. A default object is legible only because
  // the full form exists beside it: `cf sync --help` lists both scopes.
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
