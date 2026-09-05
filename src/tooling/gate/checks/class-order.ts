import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cn } from "../../../ui/core/utils/cn";
import { type CheckResult, checkResult, type Finding, fail, scannedNothing } from "../finding";
import { findClassLiterals, findSkippedClassPositions } from "./design-parse";
import { collectSource } from "./source-scan";

/** What the class-order check needs to know about the project. @public */
export interface ClassOrderCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** Files and directories to scan, relative to `root`; a `!`-prefixed entry excludes a subtree. */
  sources: readonly string[];
}

const SCANNED = (name: string): boolean => /\.tsx?$/.test(name);

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
  const collected = sources.filter((source) => !source.startsWith("!")).flatMap((source) => collectSource(root, source, SCANNED));
  const files = [...new Set(collected)].filter((file) => !excluded.some((prefix) => file === prefix || file.startsWith(`${prefix}/`))).sort();

  if (files.length === 0) return scannedNothing(`\`${sources.join("`, `")}\` matched no source`, "class-order");

  const findings = files.flatMap((file) => validateClassOrder(file, readFileSync(resolve(root, file), "utf-8")));
  return checkResult(findings, `${files.length} files: every class literal is a fixed point of \`cn\``);
}
