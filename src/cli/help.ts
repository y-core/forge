import type { CommandBase, FlagDefs } from "./types";

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

/** Renders the full help text: description, usage, sorted subcommands, and the column-aligned flag list including `--help`. @public */
export function formatHelp(command: CommandBase): string {
  const lines: string[] = [];

  if (command.description) {
    lines.push(command.description);
    lines.push("");
  }

  lines.push(formatUsage(command));

  if (command.commands.length > 0) {
    lines.push("");
    lines.push("Available Commands:");
    const sorted = [...command.commands].sort((a, b) => a.name.localeCompare(b.name));
    const maxLen = Math.max(...sorted.map((c) => c.name.length));
    for (const sub of sorted) {
      lines.push(`  ${sub.name.padEnd(maxLen + 2)}${sub.description}`);
    }
  }

  lines.push("");
  lines.push("Flags:");

  const flagEntries = Object.entries(command.flags as FlagDefs);
  type FlagRow = { short: string; name: string; description: string; suffix: string };
  const rows: FlagRow[] = [];

  for (const [name, def] of flagEntries) {
    rows.push({
      short: def.short ? `-${def.short}, ` : "    ",
      name,
      description: def.description ?? "",
      suffix: def.type === "string" && def.required ? " (required)" : "",
    });
  }
  rows.push({ short: "-h, ", name: "help", description: "Show help for this command", suffix: "" });

  const minGap = 2;
  const maxNameLen = Math.max(...rows.map((r) => r.name.length));

  for (const row of rows) {
    const prefix = `  ${row.short}`;
    const padding = " ".repeat(maxNameLen - row.name.length + minGap);
    lines.push(`${prefix}--${row.name}${padding}${row.description}${row.suffix}`);
  }

  if (command.commands.length > 0) {
    const path = commandPath(command);
    lines.push("");
    lines.push(`Use "${path} [command] --help" for more information.`);
  }

  return lines.join("\n");
}
