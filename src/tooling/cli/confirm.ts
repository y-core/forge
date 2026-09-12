import process from "node:process";
import { createInterface } from "node:readline/promises";

import { CliError } from "./errors";
import type { ConfirmOptions } from "./types";

/** Asks `Continue? [y/N]` before an irreversible action, refusing a non-interactive run that did not pass `--yes`. @public */
export async function confirm(options: ConfirmOptions): Promise<void> {
  if (options.yes) return;

  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const interactive = options.interactive ?? input.isTTY === true;
  const verb = options.verb ?? "proceed";
  const detail = options.detail === undefined ? "" : `: ${options.detail}`;

  if (!interactive) {
    throw new CliError(
      "invalid-args",
      `Refusing to ${verb} ${options.what} without a terminal to confirm at${detail}.\n${options.consequence} Pass --yes to say so deliberately.`,
    );
  }

  const say = options.print ?? ((line: string) => console.log(line));
  say(`About to ${verb} ${options.what}${detail}`);
  say(options.consequence);

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Continue? [y/N] ");
    if (answer.trim().toLowerCase() !== "y") {
      throw new CliError("invalid-args", options.cancelMessage ?? "Cancelled; nothing was changed.");
    }
  } finally {
    rl.close();
  }
}
