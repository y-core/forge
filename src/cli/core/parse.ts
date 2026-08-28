import { CliError } from "./errors";
import { suggest } from "./suggest";
import { type ArgToken, tokenize } from "./tokenize";
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

/**
 * Normalises a repeatable flag's value into the list it names.
 *
 * Trims, drops empties, and splits each element on `,`, so `--only a,b --only c` and
 * `--only a,b,c` name the same three steps. Takes a bare string too, because widening a
 * parameter is non-breaking where narrowing one is not.
 * @internal
 */
export function splitList(raw: string | readonly string[] | undefined): string[] {
  if (raw === undefined) return [];
  const parts = typeof raw === "string" ? [raw] : raw;
  return parts
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** The value a flag token carries inline, or the next argv element if that element is a value. */
function readValue(name: string, token: ArgToken, tokens: readonly ArgToken[], position: number): string {
  if (token.value !== undefined) return token.value;

  const next = tokens[position + 1];
  // A `-`-leading element is refused rather than swallowed: `forge sync --config --commit` must
  // say `Flag --config requires a value`, not silently take `--commit` as a path. The tokenizer's
  // digit guard is what narrows that rule to "looks like a flag" — `--limit -5` still works.
  if (next === undefined || next.kind !== "positional" || next.index !== token.index + 1 || next.value === "-" || next.value === undefined) {
    throw new CliError("missing-value", `Flag --${name} requires a value`);
  }
  return next.value;
}

// A near-miss is offered for a long name only. With a one-letter short flag every other short is
// one edit away, so naming one would be a guess dressed up as help.
function unknownFlag(token: ArgToken, known: readonly string[]): never {
  const long = token.raw?.startsWith("--") === true;
  const alternative = long ? suggest(token.name ?? "", known) : undefined;
  const hint = alternative === undefined ? "" : ` Did you mean --${alternative}?`;
  throw new CliError("unknown-flag", `Unknown flag: ${long ? "--" : "-"}${token.name}.${hint}`);
}

/**
 * Splits argv into positionals and flag values, applying defaults and rejecting unknown flags and
 * missing values.
 *
 * Accumulates into a `Map`, not an object literal: `--__proto__` and `--toString` are flag names
 * like any other, and an object keyed by them either round-trips a prototype member or writes one.
 * A flag repeated without `multiple` now throws, where it used to keep the last occurrence and say
 * nothing about the ones it dropped.
 * @public
 */
export function parseArgs<F extends FlagDefs>(argv: string[], flagDefs: F): { args: string[]; flags: ResolvedFlags<F> } {
  const byName = new Map<string, [string, FlagDef]>();
  const byShort = new Map<string, [string, FlagDef]>();

  for (const [name, def] of Object.entries(flagDefs)) {
    byName.set(name, [name, def]);
    if (def.short) byShort.set(def.short, [name, def]);
  }

  const collected = new Map<string, boolean | string[]>();
  const positionals: string[] = [];
  const tokens = tokenize(argv);
  const consumed = new Set<number>();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as ArgToken;
    if (token.kind === "option-terminator") continue;

    if (token.kind === "positional") {
      if (!consumed.has(i)) positionals.push(token.value ?? "");
      continue;
    }

    const entry = (token.raw?.startsWith("--") === true ? byName : byShort).get(token.name ?? "");
    if (entry === undefined) unknownFlag(token, [...byName.keys()]);
    const [flagName, flagDef] = entry;

    if (flagDef.type === "boolean") {
      collected.set(flagName, token.value === undefined ? true : token.value !== "false" && token.value !== "0");
      continue;
    }

    const value = readValue(flagName, token, tokens, i);
    if (token.value === undefined) consumed.add(i + 1);

    const existing = collected.get(flagName);
    const seen = Array.isArray(existing) ? existing : [];
    if (seen.length > 0 && flagDef.multiple !== true) {
      throw new CliError(
        "invalid-args",
        `Flag --${flagName} was given more than once, but takes a single value. Keeping only the last would silently drop "${seen.join('", "')}".`,
      );
    }
    collected.set(flagName, [...seen, value]);
  }

  for (const [name, def] of Object.entries(flagDefs)) {
    if (collected.has(name)) continue;
    if (def.type === "boolean") {
      collected.set(name, false);
    } else if (def.default !== undefined) {
      collected.set(name, [def.default]);
    } else if (def.required) {
      throw new CliError("missing-value", `Flag --${name} is required`);
    } else if (def.multiple === true) {
      collected.set(name, []);
    }
  }

  const resolved: Record<string, boolean | string | string[]> = Object.fromEntries(
    [...collected].map(([name, value]) => {
      if (typeof value === "boolean") return [name, value];
      return [
        name,
        flagDefs[name]?.type === "string" && (flagDefs[name] as { multiple?: boolean }).multiple === true ? value : (value[0] as string),
      ];
    }),
  );

  return { args: positionals, flags: resolved as ResolvedFlags<F> };
}
