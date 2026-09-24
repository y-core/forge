import { PLAIN } from "../term/color";
import { definitionList } from "../term/grid";
import { DEFAULT_WIDTH } from "../term/terminal";
import type { DefinitionEntry } from "../term/types";
import { collectFlags } from "./parse";
import type { CommandBase, FlagDef } from "./types";
import type { HelpOptions } from "./types";

function commandPath(command: CommandBase): string {
  const parts: string[] = [];
  let current: CommandBase | undefined = command;
  while (current) {
    parts.unshift(current.name);
    current = current.parent;
  }
  return parts.join(" ");
}

/** Renders the `Usage:` block for a command, spelling out its full path from the root command. @public */
export function formatUsage(command: CommandBase): string {
  const path = commandPath(command);
  const parts = [path];
  if (command.commands.length > 0) parts.push("[command]");
  parts.push("[flags]");
  if (command.args.kind !== "none") parts.push("[args]");
  return `Usage:\n  ${parts.join(" ")}`;
}

/** One flag's left-hand column: the short gutter, the long name, and the type placeholder. */
function flagTerm(name: string, def: FlagDef): string {
  const gutter = def.short ? `-${def.short}, ` : "    ";
  const placeholder = def.type === "string" ? " <string>" : "";
  return `${gutter}--${name}${placeholder}`;
}

function flagDescription(def: FlagDef): string {
  if (def.type === "boolean") return def.description ?? "";
  const suffix = def.required === true ? " (required)" : def.default === undefined ? "" : ` (default: ${def.default})`;
  return `${def.description ?? ""}${suffix}`;
}

/** Renders the full help text: description, usage, sorted subcommands, and the flag list including `--help`. @public */
export function formatHelp(command: CommandBase, options: HelpOptions = {}): string {
  const width = options.width ?? DEFAULT_WIDTH;
  const style = options.style ?? PLAIN;
  const lines: string[] = [];

  if (command.description) {
    lines.push(command.description);
    lines.push("");
  }

  lines.push(formatUsage(command));

  if (command.commands.length > 0) {
    lines.push("");
    lines.push(style.bold("Available Commands:"));
    const sorted = [...command.commands].sort((a, b) => a.name.localeCompare(b.name));
    lines.push(
      ...definitionList(
        sorted.map((sub) => ({ term: sub.name, description: sub.description })),
        { indent: 2, width },
      ),
    );
  }

  lines.push("");
  lines.push(style.bold("Flags:"));

  // `collectFlags`, not `command.flags`: the parser accepts an ancestor's persistent flag, so the
  // command's own flags alone would document a narrower surface than the one that works.
  const entries: DefinitionEntry[] = Object.entries(collectFlags(command)).map(([name, def]) => ({
    term: flagTerm(name, def),
    description: flagDescription(def),
  }));
  entries.push({ term: "-h, --help", description: "Show help for this command" });
  lines.push(...definitionList(entries, { indent: 2, width }));

  if (command.commands.length > 0) {
    lines.push("");
    lines.push(`Use "${commandPath(command)} [command] --help" for more information.`);
  }

  return lines.join("\n");
}
