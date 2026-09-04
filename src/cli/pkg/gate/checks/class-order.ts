import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import { cn } from "../../../../ui/core/utils/cn";
import { type CheckResult, checkResult, type Finding, fail } from "../finding";
import { findClassLiterals, findSkippedClassPositions } from "./design-parse";

/** What the class-order check needs to know about the project. @public */
export interface ClassOrderCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** Files and directories to scan, relative to `root`; a `!`-prefixed entry excludes a subtree. */
  sources: readonly string[];
}

const SCANNED = (name: string): boolean => /\.tsx?$/.test(name);

function collect(root: string, source: string, into: string[]): void {
  const base = resolve(root, source);
  if (!existsSync(base)) return;
  if (statSync(base).isFile()) {
    if (SCANNED(base)) into.push(relative(root, base));
    return;
  }
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const full = resolve(base, entry.name);
    if (entry.isDirectory()) collect(root, relative(root, full), into);
    else if (entry.isFile() && SCANNED(entry.name)) into.push(relative(root, full));
  }
}

/** The token `cn` drops from `literal`, or `null` when the literal is already a fixed point. */
export function droppedToken(literal: string): string | null {
  const resolved = cn(literal);
  if (resolved === literal) return null;
  const kept = resolved.split(/\s+/).filter(Boolean);
  const tokens = literal.split(/\s+/).filter(Boolean);
  let cursor = 0;
  for (const token of tokens) {
    if (token === kept[cursor]) cursor += 1;
    else return token;
  }
  return null;
}

/** Judges every class literal in one file against the fixed-point invariant. @public */
export function validateClassOrder(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const skipped of findSkippedClassPositions(source)) {
    findings.push(
      fail("class position could not be read — refusing to report a green class-order gate that skipped it", {
        file,
        line: skipped.line,
        detail: [`\`${skipped.text}\``, "the span never closes, so every class literal in it went unjudged"],
      }),
    );
  }

  for (const literal of findClassLiterals(source)) {
    const dropped = droppedToken(literal.text);
    if (dropped === null) continue;
    const key = `${literal.line}:${literal.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(
      fail("class literal is not a fixed point of `cn`", {
        file,
        line: literal.line,
        detail: [
          `\`${literal.text}\``,
          `\`${dropped}\` is dropped — two tokens claim one conflict group, so sorting the literal would change what it renders`,
        ],
      }),
    );
  }
  return findings;
}

/** Walks the configured sources and reports every self-conflicting class literal. @public */
export function checkClassOrder(config: ClassOrderCheckConfig): CheckResult {
  const { root, sources } = config;
  const excluded = sources.filter((source) => source.startsWith("!")).map((source) => source.slice(1));
  const collected: string[] = [];
  for (const source of sources) {
    if (source.startsWith("!")) continue;
    collect(root, source, collected);
  }
  const files = [...new Set(collected)].filter((file) => !excluded.some((prefix) => file === prefix || file.startsWith(`${prefix}/`))).sort();

  if (files.length === 0) {
    return checkResult(
      [fail(`\`${sources.join("`, `")}\` matched no source — refusing to report a green class-order gate that scanned nothing`)],
      "",
    );
  }

  const findings = files.flatMap((file) => validateClassOrder(file, readFileSync(resolve(root, file), "utf-8")));
  return checkResult(findings, `${files.length} files: every class literal is a fixed point of \`cn\``);
}
