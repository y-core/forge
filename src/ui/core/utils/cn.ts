import { classGroup, GROUP_OVERRIDES } from "./class-groups";

interface TokenParts {
  /** Modifier segments in source order, e.g. `["dark", "md"]` for `dark:md:h-4`. */
  readonly prefix: readonly string[];
  readonly utility: string;
  readonly important: boolean;
}

/**
 * Splits a token into its modifier segments and its utility, tracking bracket and paren depth so
 * a `:` inside an arbitrary variant is not mistaken for a modifier separator — forge emits
 * `has-[select:disabled]:opacity-50` and `[[data-slot~=x]:checked_&]:translate-x-4`.
 */
function splitModifiers(token: string): TokenParts {
  const prefix: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === "[" || ch === "(") depth += 1;
    else if (ch === "]" || ch === ")") depth -= 1;
    else if (ch === ":" && depth === 0) {
      prefix.push(token.slice(start, i));
      start = i + 1;
    }
  }

  let utility = token.slice(start);
  let important = false;
  if (utility.startsWith("!")) {
    important = true;
    utility = utility.slice(1);
  }
  if (utility.endsWith("!")) {
    important = true;
    utility = utility.slice(0, -1);
  }

  return { prefix, utility, important };
}

/**
 * Drops a trailing modifier value (`bg-primary/90` → `bg-primary`), ignoring slashes nested in an
 * arbitrary value such as `w-[calc(100%/3)]`.
 */
function stripValueSlash(utility: string): string {
  let depth = 0;
  let cut = -1;

  for (let i = 0; i < utility.length; i += 1) {
    const ch = utility[i];
    if (ch === "[" || ch === "(") depth += 1;
    else if (ch === "]" || ch === ")") depth -= 1;
    else if (ch === "/" && depth === 0) cut = i;
  }

  return cut === -1 ? utility : utility.slice(0, cut);
}

interface TokenGroup {
  /** Everything the group is qualified by: importance marker plus sorted modifiers. */
  readonly scope: string;
  readonly group: string;
}

/**
 * Resolves a token to the conflict group it occupies, scoped by its modifiers and importance.
 *
 * The modifier prefix is part of the scope, so `hover:h-5` never displaces `h-full`. Stacked
 * modifiers are sorted in the scope only — never in the emitted output — so `dark:md:h-4` and
 * `md:dark:h-4` are recognised as the same declaration.
 *
 * Importance is re-attached rather than discarded: `!important` wins the cascade regardless of
 * source order, so a later normal utility cannot displace an earlier important one.
 */
function resolveToken(token: string): TokenGroup | undefined {
  const { prefix, utility, important } = splitModifiers(token);
  const group = classGroup(stripValueSlash(utility));
  if (group === undefined) return undefined;

  const bang = important ? "!" : "";
  if (prefix.length === 0) return { scope: bang, group };
  if (prefix.length === 1) return { scope: `${bang}${prefix[0]}:`, group };
  return { scope: `${bang}${[...prefix].sort().join(":")}:`, group };
}

/**
 * Joins class-name fragments into a single space-separated string, dropping any falsy entries
 * (`false`/`null`/`undefined`) and resolving conflicting Tailwind utilities in favour of the
 * later argument — so a caller's `class` genuinely overrides a component's base. Utilities
 * outside the conflict table are always kept. See `UI_SSR_COMPONENTS.md` §3d. @public
 *
 * @example
 * cn("h-full", "h-5"); // "h-5"
 * cn("h-full", "hover:h-5"); // "h-full hover:h-5"
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  const tokens = classes.filter(Boolean).join(" ").split(/\s+/).filter(Boolean);

  const keep: boolean[] = new Array(tokens.length).fill(true);
  const consumed = new Set<string>();

  // Right-to-left with first-occurrence-wins is what makes the *last* utility the winner.
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const resolved = resolveToken(tokens[i] as string);
    if (resolved === undefined) continue;

    const key = `${resolved.scope}${resolved.group}`;
    if (consumed.has(key)) {
      keep[i] = false;
      continue;
    }

    consumed.add(key);
    const overrides = GROUP_OVERRIDES.get(resolved.group);
    if (!overrides) continue;
    for (const group of overrides) {
      consumed.add(`${resolved.scope}${group}`);
    }
  }

  return tokens.filter((_, i) => keep[i]).join(" ");
}

/** Narrows a JSX `class` prop (which may be a non-string) to `string | undefined`. @public */
export function asClass(cls: unknown): string | undefined {
  return typeof cls === "string" ? cls : undefined;
}
