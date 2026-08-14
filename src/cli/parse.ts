import { CliError } from "./errors";
import type { CommandBase, FlagDef, FlagDefs, ResolvedFlags } from "./types";

/** Collects a command's own flags together with every `persistent` flag inherited from its ancestors. @public */
export function collectFlags(command: CommandBase): FlagDefs {
  const chain: CommandBase[] = [];
  let current: CommandBase | undefined = command;
  while (current) {
    chain.unshift(current);
    current = current.parent;
  }

  const result: FlagDefs = {};
  for (const cmd of chain) {
    const isTarget = cmd === command;
    for (const [name, def] of Object.entries(cmd.flags)) {
      if (isTarget || def.persistent) {
        result[name] = def;
      }
    }
  }
  return result;
}

/** Splits argv into positionals and flag values, applying defaults and rejecting unknown flags and missing values. @public */
export function parseArgs<F extends FlagDefs>(argv: string[], flagDefs: F): { args: string[]; flags: ResolvedFlags<F> } {
  const byName = new Map<string, [string, FlagDef]>();
  const byShort = new Map<string, [string, FlagDef]>();

  for (const [name, def] of Object.entries(flagDefs)) {
    byName.set(name, [name, def]);
    if (def.short) byShort.set(def.short, [name, def]);
  }

  const parsed: Record<string, boolean | string> = {};
  const positionals: string[] = [];
  let stopFlags = false;
  let i = 0;

  while (i < argv.length) {
    const token = argv[i];
    if (token === undefined) break;

    if (token === "--") {
      stopFlags = true;
      i++;
      continue;
    }

    if (stopFlags || token === "-" || !token.startsWith("-")) {
      positionals.push(token);
      i++;
      continue;
    }

    let flagToken = token;
    let inlineValue: string | undefined;
    const eqIdx = token.indexOf("=");
    if (eqIdx !== -1) {
      flagToken = token.slice(0, eqIdx);
      inlineValue = token.slice(eqIdx + 1);
    }

    let flagName: string;
    let flagDef: FlagDef;

    if (flagToken.startsWith("--")) {
      const name = flagToken.slice(2);
      const entry = byName.get(name);
      if (!entry) throw new CliError("unknown-flag", `Unknown flag: --${name}`);
      [flagName, flagDef] = entry;
    } else {
      const short = flagToken.slice(1);
      const entry = byShort.get(short);
      if (!entry) throw new CliError("unknown-flag", `Unknown flag: -${short}`);
      [flagName, flagDef] = entry;
    }

    if (flagDef.type === "boolean") {
      parsed[flagName] = inlineValue !== undefined ? inlineValue !== "false" && inlineValue !== "0" : true;
      i++;
    } else {
      if (inlineValue !== undefined) {
        parsed[flagName] = inlineValue;
        i++;
      } else {
        i++;
        const value = argv[i];
        if (value === undefined || value.startsWith("-")) {
          throw new CliError("missing-value", `Flag --${flagName} requires a value`);
        }
        parsed[flagName] = value;
        i++;
      }
    }
  }

  for (const [name, def] of Object.entries(flagDefs)) {
    if (name in parsed) continue;
    if (def.type === "boolean") {
      parsed[name] = false;
    } else if (def.default !== undefined) {
      parsed[name] = def.default;
    } else if (def.required) {
      throw new CliError("missing-value", `Flag --${name} is required`);
    }
  }

  return { args: positionals, flags: parsed as ResolvedFlags<F> };
}
