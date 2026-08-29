import { createAssetsCommands } from "../assets/commands";
import { createGenEnv } from "../cfgen/cf-env-command";
import { addCommand, createCommand } from "../core/command";
import type { CommandBase } from "../core/types";
import { createGateBinCommand } from "../pkg/gate/command";
import { loadConfigModule } from "../pkg/internal/config-module";
import { createReleaseBinCommand } from "../pkg/release/release";
import { createSyncCommand } from "../sync/commands";
import { createSyncZoneCommand } from "../sync/zone";

/** Where `forge` looks for an application's own command table. @public */
export const DEFAULT_COMMANDS_CONFIG = "config/commands.ts";

/** Assembles the `forge` command tree: the first-party commands, then whatever `config/commands.ts`
 *  default-exports. An app without that file gets the first-party tree unchanged. @public */
export async function createRootCommand(cwd: string = process.cwd()): Promise<CommandBase> {
  const root = createCommand({ name: "forge", description: "Build, verify, release, and provision a @y-core/forge application" });

  addCommand(root, createGateBinCommand());
  addCommand(root, createReleaseBinCommand());
  const sync = createSyncCommand();
  addCommand(sync, createSyncZoneCommand());
  addCommand(root, sync);
  addCommand(root, createAssetsCommands());
  addCommand(root, createGenEnv());

  const commands = await loadConfigModule<readonly CommandBase[]>({
    root: cwd,
    path: DEFAULT_COMMANDS_CONFIG,
    explicit: false,
    what: "command table",
  });
  for (const command of commands ?? []) addCommand(root, command);

  return root;
}
