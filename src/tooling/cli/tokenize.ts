import type { ArgToken } from "./types";
// Token shape, the argv-index rule and the digit guards are adopted from
// @visulima/command-line-args (MIT, Copyright (c) visulima), itself after args-tokens
// (MIT, Copyright (c) 2025 kazuya kawaguchi)
// https://github.com/visulima/visulima — packages/terminal/command-line-args/src/tokenizer.ts

const DIGITS = /^[0-9]$/;

/** Whether the character after the leading `-` is a digit, i.e. this is a negative number. */
function startsWithDigit(arg: string): boolean {
  return DIGITS.test(arg[1] ?? "");
}

function longToken(arg: string, index: number): ArgToken {
  const eq = arg.indexOf("=", 3);
  if (eq === -1) return { kind: "option", index, name: arg.slice(2), raw: arg };
  return { kind: "option", index, name: arg.slice(2, eq), raw: arg.slice(0, eq), value: arg.slice(eq + 1), inline: true };
}

/** Expands `-abc` into `-a -b -c`, and `-ab=cd` into `-a -b=cd`. */
function clusterTokens(arg: string, index: number): ArgToken[] {
  const eq = arg.indexOf("=");
  const letters = [...(eq === -1 ? arg.slice(1) : arg.slice(1, eq))];
  const value = eq === -1 ? undefined : arg.slice(eq + 1);

  return letters.map((letter, position) => {
    const last = position === letters.length - 1;
    const base: ArgToken = { kind: "option", index, name: letter, raw: `-${letter}` };
    return last && value !== undefined ? { ...base, value, inline: true } : base;
  });
}

/**
 * Splits argv into classified tokens, knowing nothing about any command's flags.
 *
 * Definition-agnostic on purpose: what `--only` means is a question for `parse.ts`, and keeping
 * the two apart is what stops the resolution rules and the lexical rules from being written as
 * one loop that has to be reread whole every time either changes.
 * @public
 */
export function tokenize(argv: readonly string[]): ArgToken[] {
  const tokens: ArgToken[] = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;

    if (arg === "--") {
      tokens.push({ kind: "option-terminator", index });
      for (let rest = index + 1; rest < argv.length; rest++) tokens.push({ kind: "positional", index: rest, value: argv[rest] as string });
      return tokens;
    }

    // A lone `-`, anything not starting with one, and `-12`/`-1.5` are values. The digit guard is
    // what lets a negative number be passed where a flag could have gone.
    if (arg === "-" || !arg.startsWith("-") || startsWithDigit(arg)) {
      tokens.push({ kind: "positional", index, value: arg });
      continue;
    }

    if (arg.startsWith("--")) {
      // `--` alone was handled above, so anything left is a name or an empty one.
      tokens.push(longToken(arg, index));
      continue;
    }

    tokens.push(...clusterTokens(arg, index));
  }

  return tokens;
}
