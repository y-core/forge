import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { type CheckResult, checkResult, type Finding, fail } from "../finding";
import { type ClassGroupTable, deriveClassGroups } from "./class-groups-parse";
import { stripComments } from "./css-parse";
import { loadDesignSystem } from "./design-system";

/** What the theme-token namespace check needs to know about the project. @public */
export interface CssTokensCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** The stylesheet the design system is compiled from, relative to `root`. */
  stylesheet: string;
  /** Directory of stylesheets whose `@theme` blocks are read, relative to `root`. */
  cssDir: string;
}

/** One `@theme` token, with the line it is declared on. */
interface ThemeToken {
  property: string;
  line: number;
}

/** Every custom property declared inside a `@theme` block — the tokens that become utilities. @public */
export function findThemeTokens(css: string): ThemeToken[] {
  const source = stripComments(css);
  const out: ThemeToken[] = [];

  for (const match of source.matchAll(/@theme\b[^{]*\{/g)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = source.length;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}" && (depth -= 1) === 0) {
        end = i;
        break;
      }
    }
    const body = source.slice(start, end);
    const lineBase = source.slice(0, start).split("\n").length;
    for (const declared of body.matchAll(/(--[a-z0-9]+(?:-[a-z0-9]+)*)\s*:/g)) {
      out.push({ property: declared[1] as string, line: lineBase + body.slice(0, declared.index).split("\n").length - 1 });
    }
  }
  return out;
}

/** The utility roots whose named value means one concern and whose enumerated values mean another. @public */
export function overloadedRoots(table: ClassGroupTable): ReadonlyMap<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>();
  for (const [root, row] of table.roots) {
    if (row.named === undefined || row.exceptions === undefined) continue;
    out.set(root, new Set(row.exceptions.values));
  }
  return out;
}

/** Every `.css` file under `dir`, relative to it and sorted. */
function collectStylesheets(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".css")) out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

// Longest root wins, exactly as `classGroup` resolves a utility — which is what lets `--text-size-*`
// be unambiguous while `--text-*` is not.
function rootOf(table: ClassGroupTable, utility: string): { root: string; value: string } | undefined {
  for (let i = utility.length - 1; i > 0; i -= 1) {
    if (utility[i] !== "-") continue;
    const root = utility.slice(0, i);
    if (table.roots.has(root)) return { root, value: utility.slice(i + 1) };
  }
  return undefined;
}

/** Reports every `@theme` token forge declares in an overloaded namespace. @public */
export async function checkCssTokens(config: CssTokensCheckConfig): Promise<CheckResult> {
  const dir = resolve(config.root, config.cssDir);
  const files = collectStylesheets(dir);
  if (files.length === 0) {
    return checkResult([fail(`\`${config.cssDir}\` matched no stylesheet — refusing to report a green css-tokens gate that scanned nothing`)], "");
  }

  const table = deriveClassGroups(await loadDesignSystem(resolve(config.root, config.stylesheet)));
  const overloaded = overloadedRoots(table);
  const findings: Finding[] = [];

  let tokens = 0;
  for (const name of files) {
    for (const token of findThemeTokens(readFileSync(resolve(dir, name), "utf-8"))) {
      tokens += 1;
      const utility = token.property.slice(2);
      const match = rootOf(table, utility);
      if (match === undefined) continue;
      const enumerated = overloaded.get(match.root);
      if (enumerated === undefined || enumerated.has(match.value)) continue;
      findings.push(
        fail(
          `\`${token.property}\` declares a token in the \`${match.root}-*\` namespace, where \`${utility}\` reads as the other concern that root carries — so \`cn\` drops it against a utility it does not actually conflict with`,
          {
            file: `${config.cssDir}/${name}`,
            line: token.line,
            detail: [
              `\`${match.root}-*\` means one thing for the values the design system enumerates and another for any name it does not`,
              "declare the step in a namespace of its own — a scale step is `--text-size-*` — so its concern is legible from the name",
            ],
          },
        ),
      );
    }
  }

  return checkResult(findings, `${tokens} theme tokens over ${files.length} stylesheets, ${overloaded.size} overloaded namespaces`);
}
