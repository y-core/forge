import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { utilityOf } from "../../../ui/core/utils/cn";
import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { loadDesignSystem } from "./design-system";
import { balancedSpan, blankSourceComments, lineAt, resolveSources } from "./source-scan";
import type { ClassTokensCheckConfig, SourceLiteral } from "./types";

// Specs are excluded: they assert on *rendered* markup, so a class string in one is a fragment of an
// HTML literal (`gap-4"></ol>`) or an invented fixture name — neither is a token anything renders.
const SCANNED = (name: string): boolean => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name);

// Every literal, not only the ones in a class position: a class string can live in a module-level
// `const` (`src/ui/core/link.tsx`), which no class-position scan reaches.
/** Every string literal in `source`, comments blanked and `${…}` interpolations cut out. @public */
export function stringLiterals(source: string): SourceLiteral[] {
  const scanned = blankSourceComments(source);
  const out: SourceLiteral[] = [];
  const lineOf = (index: number): number => lineAt(scanned, index);

  for (let i = 0; i < scanned.length; i += 1) {
    const quote = scanned[i];
    if (quote !== "'" && quote !== '"' && quote !== "`") continue;

    let chunk = i + 1;
    let j = chunk;
    for (; j < scanned.length; j += 1) {
      const char = scanned[j];
      if (char === "\\") {
        j += 1;
        continue;
      }
      if (char === quote) break;
      // A `'` or `"` cannot hold a raw newline: one that reaches the line end is an apostrophe in prose.
      if (char === "\n" && quote !== "`") break;
      if (quote !== "`" || char !== "$" || scanned[j + 1] !== "{") continue;
      const close = balancedSpan(scanned, j + 1);
      if (close === -1) break;
      out.push({ line: lineOf(chunk), text: scanned.slice(chunk, j) });
      j = close;
      chunk = close + 1;
    }
    if (j >= scanned.length || scanned[j] !== quote) {
      i = chunk - 1;
      continue;
    }
    out.push({ line: lineOf(chunk), text: scanned.slice(chunk, j) });
    i = j;
  }
  return out;
}

/** The shortest declared utility a typo could plausibly have been, or `undefined`. */
function longestOverlap(utility: string, declared: ReadonlySet<string>): string | undefined {
  let best: string | undefined;
  for (const candidate of declared) {
    // Both directions, so an appended character and a truncated one are both reachable. A shared
    // prefix shorter than half the token is coincidence, not a typo.
    if (!utility.startsWith(candidate) && !candidate.startsWith(utility)) continue;
    const shared = Math.min(utility.length, candidate.length);
    if (shared * 2 < utility.length) continue;
    if (best === undefined || candidate.length > best.length) best = candidate;
  }
  return best;
}

// A near miss, not any unknown token: a literal also holds words that were never classes, so only a
// token the design system nearly declares is reportable. The dash walk alone could not reach a forge
// `@utility` — all nine are `<family>-<word>` and no family is itself declared, so `state-invalidd`
// went unreported while the summary claimed every class string resolves to CSS.
function nearMiss(utility: string, declared: ReadonlySet<string>): string | undefined {
  for (let i = utility.length - 1; i > 0; i -= 1) {
    if (utility[i] !== "-") continue;
    const prefix = utility.slice(0, i);
    if (declared.has(prefix)) return prefix;
  }
  return longestOverlap(utility, declared);
}

/** What an unrecognised token has to look like for the literal holding it to still read as a class string. */
const CLASS_SHAPED = /[-/[\]:@()]/;

/** Judges every class token in one file against the design system that has to produce CSS for it. @public */
export function unknownTokens(file: string, source: string, known: (token: string) => boolean, declared: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const literal of stringLiterals(source)) {
    const tokens = literal.text.split(/\s+/).filter(Boolean);
    const suspect = tokens.filter((token) => !known(token)).map((token) => [token, nearMiss(utilityOf(token), declared)] as const);

    // What keeps prose out: a literal is a class string only when at least one token resolves to CSS
    // and every token that does not is at least *shaped* like a class.
    if (suspect.length === tokens.length || suspect.some(([token]) => !CLASS_SHAPED.test(token))) continue;

    for (const [token, near] of suspect) {
      if (near === undefined) continue;
      const key = `${literal.line}:${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(
        fail("class token matches no utility the design system produces CSS for", {
          file,
          line: literal.line,
          detail: [`\`${token}\``, `\`${near}\` is a utility this design system declares — \`${token}\` is not, so it renders nothing`],
        }),
      );
    }
  }
  return findings;
}

/** Walks the configured sources and reports every class token the compiled design system produces no CSS for. @public */
export async function checkClassTokens(config: ClassTokensCheckConfig): Promise<CheckResult> {
  const { root, sources } = config;
  const files = resolveSources(root, sources, SCANNED);

  if (files.length === 0) return scannedNothing(`\`${sources.join("`, `")}\` matched no source`, "class-token");

  const contents = new Map(files.map((file) => [file, readFileSync(resolve(root, file), "utf-8")]));
  const ds = await loadDesignSystem(resolve(root, config.stylesheet));
  const declared = new Set([...ds.utilities.keys("static"), ...ds.utilities.keys("functional")]);

  const candidates = [
    ...new Set([...contents.values()].flatMap((source) => stringLiterals(source).flatMap((literal) => literal.text.split(/\s+/)))),
  ].filter(Boolean);
  // A candidate Tailwind cannot turn into a rule comes back as `null` or as an empty node list,
  // depending on the version — both mean the same thing, so both count as producing no CSS.
  const parsed = ds.candidatesToAst(candidates);
  const known = new Set(candidates.filter((_, i) => (parsed[i]?.length ?? 0) > 0));

  const findings = files.flatMap((file) => unknownTokens(file, contents.get(file) as string, (token) => known.has(token), declared));
  // Not "every class string resolves to CSS": a token the design system nowhere nearly declares is
  // dropped as prose, and an all-unknown literal is skipped entirely. What this check catches is the
  // near miss — a token one edit away from a utility that exists.
  return checkResult(findings, `${candidates.length} distinct tokens over ${files.length} files: no class token near-misses a real utility`);
}
