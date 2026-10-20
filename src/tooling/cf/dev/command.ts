import process, { exit } from "node:process";

import { createCommand } from "../../cli/command";
import { CliError } from "../../cli/errors";
import { runUnchecked } from "../../cli/proc";
import type { CommandBase, SpawnSync } from "../../cli/types";
import { appendForgeDev } from "./conditions";

/** Builds `forge cf dev`: `wrangler dev` under the `forge-dev` condition with `__FORGE_DEV__` defined, exiting as wrangler exits. @public */
export function createDevCommand(spawn?: SpawnSync): CommandBase {
  return createCommand({
    name: "dev",
    description:
      "Run `wrangler dev` with forge's development modules armed. With several -c configs the define reaches only the first, so put the app's config first. Pass wrangler's own flags after --, as in `forge cf dev -- --port 8788`",
    args: { kind: "min", min: 0 },
    run(args, _flags, ctx) {
      const quit: (code: number) => never = ctx?.io.exit ?? exit;
      const env = { ...process.env, WRANGLER_BUILD_CONDITIONS: appendForgeDev(process.env.WRANGLER_BUILD_CONDITIONS) };
      const outcome = runUnchecked("wrangler", ["dev", "--define", "__FORGE_DEV__:true", ...args], { env }, spawn);
      if (outcome.spawnError !== undefined) throw new CliError("external", `wrangler could not be started: ${outcome.spawnError}`);
      if (outcome.code !== 0) quit(outcome.code);
    },
  });
}
