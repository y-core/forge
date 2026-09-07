import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { CliError } from "../../../src/tooling/cli/errors";
import { WARDEN_ROOT } from "../paths";

/** The shipped example files `warden show` can write to stdout. @public */
export const SUBJECTS = {
  zed: {
    file: "share/zed-settings.json",
    destination: join(homedir(), ".config/zed/settings.json"),
    summary: "Zed user settings — oxlint, oxfmt and typescript-ls, each resolved from the open project",
  },
} as const;

/** A subject `warden show` knows. @public */
export type Subject = keyof typeof SUBJECTS;

/** Writes one shipped example to stdout, leaving every caveat on stderr. @public */
export function show(subject: Subject): void {
  const { file, destination } = SUBJECTS[subject];
  const source = join(WARDEN_ROOT, file);
  if (!existsSync(source)) throw new CliError("invalid-args", `the installed warden directory has no ${file}`);

  // stdout carries the payload alone, so it survives a pipe; everything else goes to stderr.
  process.stdout.write(readFileSync(source, "utf-8"));

  // Never suggest a redirect: an existing settings file holds the developer's own configuration,
  // and Zed reads JSONC, so overwriting it silently discards both those settings and their comments.
  if (existsSync(destination)) {
    console.error(`\n${destination} already exists — merge these keys into it by hand.`);
    console.error("Overwriting it would discard your own settings, and any comments with them.");
  } else {
    console.error(`\nNo file at ${destination} yet — create it with these contents.`);
  }
}
