import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { classGroup } from "../../../ui/core/utils/class-groups";
import { utilityOf } from "../../../ui/core/utils/cn";
import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { stringLiterals } from "./class-tokens";
import { blankComments, endOfCssString, isTestSource, lineAt, resolveSources, unresolvedSourceEntries } from "./source-scan";
import type { ContrastPairInput, FadedTextCheckConfig } from "./types";

const SCANNED = (name: string): boolean => (/\.tsx?$/.test(name) || name.endsWith(".css")) && !isTestSource(name);

const TEXT_COLOUR = /^text-(?:\((--[a-z0-9-]+)\)|([a-z][a-z0-9-]*))$/;

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function variantsOf(token: string, utility: string): string[] {
  return splitTopLevel(token.slice(0, token.lastIndexOf(utility)), ":")
    .map((segment) => segment.replace(/^!/, ""))
    .filter(Boolean);
}

function alphaOf(value: string): number | "unmeasurable" {
  if (/^\d+$/.test(value)) return Number(value) / 100;
  const percent = /^\[(\d+(?:\.\d+)?)%\]$/.exec(value);
  if (percent) return Number(percent[1]) / 100;
  const decimal = /^\[(\d*\.?\d+)\]$/.exec(value);
  if (decimal) return Number(decimal[1]);
  return "unmeasurable";
}

function strengthOf(utility: string): number | "unmeasurable" | undefined {
  if (!utility.startsWith("opacity-")) return undefined;
  return alphaOf(utility.slice("opacity-".length));
}

function modifierOf(token: string, utility: string): number | "unmeasurable" | undefined {
  if (!utility.startsWith("text-") || classGroup(utility) !== "color") return undefined;
  const tail = token.slice(token.lastIndexOf(utility) + utility.length).replace(/!$/, "");
  return tail.startsWith("/") ? alphaOf(tail.slice(1)) : undefined;
}

const DISABLED_STATE = /^(?:(?:group|peer)-)?(?:disabled|aria-disabled|data-disabled|aria-\[disabled=true\]|data-\[disabled(?:=true)?\])$/;
const GROUP_NAME = /^((?:group|peer)-.+)\/[\w-]+$/;

function exemptChain(variants: readonly string[]): boolean {
  return variants.some((segment) => DISABLED_STATE.test(segment.replace(GROUP_NAME, "$1")));
}

function colourOf(utility: string): string | undefined {
  const match = TEXT_COLOUR.exec(utility);
  if (!match || classGroup(utility) !== "color") return undefined;
  return match[1] ?? `--${match[2]}`;
}

function heldBy(tokens: readonly string[], chain: string, strength: number, pairs: readonly ContrastPairInput[]): boolean {
  return tokens.some((token) => {
    const utility = utilityOf(token);
    const colour = colourOf(utility);
    if (colour === undefined || variantsOf(token, utility).join(":") !== chain) return false;
    return pairs.some((pair) => pair.foreground.token === colour && pair.foreground.alpha === strength);
  });
}

function judgeToken(
  file: string,
  line: number,
  token: string,
  tokens: readonly string[],
  pairs: readonly ContrastPairInput[],
  seen: Set<string>,
): Finding[] {
  const utility = utilityOf(token);
  const opacity = strengthOf(utility);
  const strength = opacity ?? modifierOf(token, utility);
  if (strength === undefined || strength === 0 || strength === 1) return [];

  const chain = variantsOf(token, utility);
  if (exemptChain(chain)) return [];

  const key = `${line}:${token}`;
  if (seen.has(key)) return [];

  if (strength === "unmeasurable") {
    seen.add(key);
    return [
      fail(`\`${token}\` fades what this class paints by an amount the contrast audit cannot measure — write it as a number, or drop it`, {
        file,
        line,
      }),
    ];
  }

  const percent = Math.round(strength * 100);
  if (opacity !== undefined) {
    if (heldBy(tokens, chain.join(":"), strength, pairs)) return [];
    seen.add(key);
    return [
      fail(
        `\`${token}\` paints at ${percent}% strength, which the contrast audit measures at 100% — drop it, or name the colour beside it and audit a pair whose foreground carries \`alpha: ${strength}\``,
        { file, line },
      ),
    ];
  }

  const colour = colourOf(utility);
  if (pairs.some((pair) => pair.foreground.token === colour && pair.foreground.alpha === strength)) return [];
  seen.add(key);
  return [
    fail(
      `\`${token}\` paints its colour at ${percent}% strength, which the contrast audit measures at 100% — drop the modifier, or audit a pair whose foreground carries this colour at \`alpha: ${strength}\``,
      { file, line },
    ),
  ];
}

const DISABLED_SELECTOR = /:disabled\b|\[(?:aria|data)-disabled(?:="?true"?)?\]/;

function groupEnd(selector: string, open: number): number {
  let depth = 0;
  for (let j = open; j < selector.length; j += 1) {
    if (selector[j] === "(") depth += 1;
    else if (selector[j] === ")" && --depth === 0) return j;
  }
  return selector.length;
}

function namesDisabledState(selector: string): boolean {
  let reduced = "";
  let i = 0;
  while (i < selector.length) {
    const group = /^:(not|is|where)\(/.exec(selector.slice(i));
    if (group === null) {
      reduced += selector[i];
      i += 1;
      continue;
    }
    const open = i + group[0].length - 1;
    const close = groupEnd(selector, open);
    if (group[1] !== "not" && splitTopLevel(selector.slice(open + 1, close), ",").every(namesDisabledState)) reduced += ":disabled";
    i = close + 1;
  }
  return DISABLED_SELECTOR.test(reduced);
}

function paintsOnlyDisabled(prelude: string): boolean {
  if (prelude.startsWith("@")) return false;
  return splitTopLevel(prelude, ",").every(namesDisabledState);
}

function appliedFades(file: string, source: string, pairs: readonly ContrastPairInput[]): Finding[] {
  const css = blankComments(source);
  const preludes: string[] = [];
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i];
    if (char === '"' || char === "'") {
      const end = endOfCssString(css, i);
      if (end === -1) {
        const line = lineAt(css, i);
        findings.push(
          fail(`a \`${char}\` string opened on line ${line} never closes, so the rest of this stylesheet goes unjudged — close it`, { file, line }),
        );
        break;
      }
      i = end - 1;
      continue;
    }
    if (char !== "{" && char !== "}" && char !== ";") continue;
    const statementStart = start;
    const statement = css.slice(statementStart, i);
    start = i + 1;
    if (char === "{") {
      preludes.push(statement.trim());
      continue;
    }
    if (statement.trim().startsWith("@apply") && !preludes.some(paintsOnlyDisabled)) {
      const line = lineAt(css, statementStart + statement.indexOf("@apply"));
      const tokens = statement.trim().slice("@apply".length).split(/\s+/).filter(Boolean);
      for (const token of tokens) findings.push(...judgeToken(file, line, token, tokens, pairs, seen));
    }
    if (char === "}") preludes.pop();
  }
  return findings;
}

/** Every fade below full strength in one file — class strings, or `@apply` in a stylesheet — that no disabled state or audited alpha pair holds. @public */
export function fadedText(file: string, source: string, pairs: readonly ContrastPairInput[]): Finding[] {
  if (file.endsWith(".css")) return appliedFades(file, source, pairs);
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const literal of stringLiterals(source)) {
    const tokens = literal.text.split(/\s+/).filter(Boolean);
    for (const token of tokens) findings.push(...judgeToken(file, literal.line, token, tokens, pairs, seen));
  }
  return findings;
}

/** Walks the configured sources and fails every fade below full strength that nothing holds. @public */
export function checkFadedText(config: FadedTextCheckConfig): CheckResult {
  const { root, sources, pairs } = config;
  const unresolved = unresolvedSourceEntries(root, sources);
  if (unresolved.length > 0) return checkResult(unresolved, "");

  const files = resolveSources(root, sources, SCANNED);
  if (files.length === 0) return scannedNothing(`\`${sources.join("`, `")}\` matched no source`, "faded-text");

  const findings = files.flatMap((file) => fadedText(file, readFileSync(resolve(root, file), "utf-8"), pairs));
  return checkResult(findings, `${files.length} files scanned.`);
}
