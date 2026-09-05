import { createAssetsCommands } from "../assets/commands";
import { createCfCommands } from "../cf/commands";
import { addCommand, createCommand } from "../cli/command";
import { loadConfigModule } from "../cli/config-module";
import type { CommandBase } from "../cli/types";
import { createGateBinCommand } from "../gate/command";
import { createReleaseBinCommand } from "../release/release";

/** Where `forge` looks for an application's own command table. @public */
export const DEFAULT_COMMANDS_CONFIG = "config/commands.ts";

/** Assembles the `forge` command tree: the first-party commands, then whatever `config/commands.ts`
 *  default-exports. An app without that file gets the first-party tree unchanged. @public */
export async function createRootCommand(cwd: string = process.cwd()): Promise<CommandBase> {
  const root = createCommand({ name: "forge", description: "Build, verify, release, and provision a @y-core/forge application" });

  addCommand(root, createGateBinCommand());
  addCommand(root, createReleaseBinCommand());
  addCommand(root, createCfCommands());
  addCommand(root, createAssetsCommands());

  const commands = await loadConfigModule<readonly CommandBase[]>({
    root: cwd,
    path: DEFAULT_COMMANDS_CONFIG,
    explicit: false,
    what: "command table",
  });
  for (const command of commands ?? []) addCommand(root, command);

  return root;
}
