import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { posix, relative, resolve, sep } from "node:path";

import { err, ok } from "../../../src/result/result";
import type { Result } from "../../../src/result/types";
import type { RegisteredRule, RgDetector } from "./types";

/** One line a rule's pattern matched. @public */
export interface CheckFinding {
  readonly rule: string;
  readonly level: RgDetector["level"];
  /** Repository-relative, posix-separated. */
  readonly file: string;
  readonly line: number;
  /** The matched line, trimmed and capped. */
  readonly match: string;
}

/** What a finding's rule says, given once per rule rather than per finding. @public */
export interface CheckedRule {
  readonly id: string;
  readonly statement: string;
  /** The `knowledge_read` id of the section arguing the rule. */
  readonly rationale: string;
  readonly triage?: string;
}

/** Every finding `check` made, and the rules they name. @public */
export interface CheckReport {
  readonly findings: readonly CheckFinding[];
  readonly rules: readonly CheckedRule[];
  /** How many files the detectors read. */
  readonly scanned: number;
}

/** What `check` matches, and over which files. @public */
export interface CheckOptions {
  /** Repository root; every path is relative to it. */
  readonly root: string;
  readonly rules: readonly RegisteredRule[];
  /** Only these repository-relative files, each still narrowed by a detector's paths and globs. */
  readonly files?: readonly string[];
  /** Only files changed against this git ref, untracked ones included. */
  readonly diff?: string;
  /** Only these rule ids. */
  readonly ids?: readonly string[];
  /** Only detectors at this level. */
  readonly level?: RgDetector["level"];
}

const LOOKAROUND = /\(\?<?[=!]|\\[1-9]/;

const MATCH_CAP = 200;

/** The `rg` command a detector stands for, so a reviewer can rerun it by hand. @public */
export function rgArgv(detector: RgDetector): string[] {
  return [
    "rg",
    "-n",
    ...(detector.pcre === true ? ["-P"] : []),
    ...(detector.ignoreCase === true ? ["-i"] : []),
    // `-e` keeps a pattern that opens with `-` from being read as a flag.
    "-e",
    detector.pattern,
    ...detector.paths,
    ...(detector.include ?? []).flatMap((glob) => ["--glob", glob]),
    ...(detector.exclude ?? []).flatMap((glob) => ["--glob", `!${glob}`]),
  ];
}

/** The detector's pattern compiled as `warden check` runs it, or why it cannot be. @public */
export function compileDetector(detector: RgDetector): Result<RegExp, string> {
  if (detector.pcre !== true && LOOKAROUND.test(detector.pattern)) return err("uses lookaround or a backreference without `pcre: true`");
  try {
    return ok(new RegExp(detector.pattern, detector.ignoreCase === true ? "iu" : "u"));
  } catch (error) {
    return err(`does not compile — ${error instanceof Error ? error.message : String(error)}`);
  }
}

function globSource(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] ?? "";
    if (char === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else if (char === "[") {
      const close = glob.indexOf("]", i + 1);
      if (close === -1) out += "\\[";
      else {
        const body = glob.slice(i + 1, close);
        out += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`;
        i = close;
      }
    } else if (char === "{") {
      const close = glob.indexOf("}", i + 1);
      if (close === -1) out += "\\{";
      else {
        out += `(?:${glob
          .slice(i + 1, close)
          .split(",")
          .map(globSource)
          .join("|")})`;
        i = close;
      }
    } else out += char.replace(/[.+^$()|\\]/g, "\\$&");
  }
  return out;
}

/** An rg `--glob` as a test of a repository-relative path: anchored when it holds a `/`, else against any one segment. @internal */
export function globMatcher(glob: string, mode: "include" | "exclude"): (path: string) => boolean {
  const trimmed = glob.replace(/^\//, "").replace(/\/$/, "");
  const pattern = new RegExp(`^${globSource(trimmed)}$`);
  if (trimmed.includes("/")) {
    return (path) => {
      if (pattern.test(path)) return true;
      if (mode === "include") return false;
      const segments = path.split("/");
      return segments.slice(1).some((_segment, index) => pattern.test(segments.slice(0, index + 1).join("/")));
    };
  }
  return (path) => {
    const segments = path.split("/");
    return mode === "include" ? pattern.test(segments.at(-1) ?? "") : segments.some((segment) => pattern.test(segment));
  };
}

function git(root: string, args: readonly string[]): string | undefined {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  return run.status === 0 ? run.stdout : undefined;
}

function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(relative(root, full).split(sep).join(posix.sep));
    }
  };
  visit(root);
  return out;
}

/** The files `rg` would search under `root`: git's tracked and untracked-but-not-ignored files where `root` is a work tree, else a walk skipping hidden entries and `node_modules`. @internal */
export function searchableFiles(root: string): string[] {
  const listed = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (listed === undefined) return walk(root).sort();
  const hidden = (path: string): boolean => path.split("/").some((segment) => segment.startsWith("."));
  return [...new Set(listed.split("\0"))].filter((path) => path !== "" && !hidden(path) && existsSync(resolve(root, path))).sort();
}

function changedFiles(root: string, ref: string): Result<string[], string> {
  // `--relative` names paths from `root`, not from the top level, which is what every other path here is relative to.
  const changed = git(root, ["diff", "-z", "--name-only", "--relative", "--diff-filter=d", ref]);
  if (changed === undefined) return err(`\`git diff ${ref}\` failed — is \`${ref}\` a ref in ${root}?`);
  const untracked = git(root, ["ls-files", "-z", "--others", "--exclude-standard"]) ?? "";
  return ok([...new Set([...changed.split("\0"), ...untracked.split("\0")])].filter((path) => path !== "").sort());
}

function underPath(file: string, path: string): boolean {
  const base = posix.normalize(path.split(sep).join(posix.sep)).replace(/\/$/, "");
  return base === "." || file === base || file.startsWith(`${base}/`);
}

/** Whether a detector's paths and globs reach `file`. @internal */
export function detectorReaches(detector: RgDetector, file: string): boolean {
  if (!detector.paths.some((path) => underPath(file, path))) return false;
  const include = detector.include ?? [];
  if (include.length > 0 && !include.some((glob) => globMatcher(glob, "include")(file))) return false;
  return !(detector.exclude ?? []).some((glob) => globMatcher(glob, "exclude")(file));
}

function readText(path: string): string | undefined {
  try {
    if (!statSync(path).isFile()) return undefined;
    const text = readFileSync(path, "utf-8");
    return text.includes("\0") ? undefined : text;
  } catch {
    return undefined;
  }
}

/** Matches every `rg` detector of `rules` over the tree, a file list or a diff, line by line as `rg -n` does. @public */
export function sweepRules(options: CheckOptions): Result<CheckReport, string> {
  const { root } = options;
  const ids = options.ids === undefined ? undefined : new Set(options.ids);
  if (ids !== undefined) {
    const unknown = [...ids].filter((id) => !options.rules.some((rule) => rule.id === id));
    if (unknown.length > 0) return err(`no registered rule is named ${unknown.map((id) => `\`${id}\``).join(", ")}`);
  }

  const detectors: { rule: RegisteredRule; detector: RgDetector; pattern: RegExp }[] = [];
  for (const rule of options.rules) {
    if (ids !== undefined && !ids.has(rule.id)) continue;
    for (const detector of rule.detectors) {
      if (detector.kind !== "rg" || (options.level !== undefined && detector.level !== options.level)) continue;
      const pattern = compileDetector(detector);
      if (!pattern.ok) return err(`rule \`${rule.id}\`'s pattern ${pattern.error}`);
      detectors.push({ rule, detector, pattern: pattern.data });
    }
  }

  let candidates: string[];
  if (options.diff !== undefined) {
    const changed = changedFiles(root, options.diff);
    if (!changed.ok) return changed;
    candidates = changed.data;
  } else candidates = options.files === undefined ? searchableFiles(root) : options.files.map((file) => file.split(sep).join(posix.sep));

  const findings: CheckFinding[] = [];
  let scanned = 0;
  for (const file of candidates) {
    const reaching = detectors.filter(({ detector }) => detectorReaches(detector, file));
    if (reaching.length === 0) continue;
    const text = readText(resolve(root, file));
    if (text === undefined) continue;
    scanned++;
    const lines = text.split("\n");
    for (const { rule, detector, pattern } of reaching) {
      lines.forEach((line, index) => {
        if (pattern.test(line))
          findings.push({ rule: rule.id, level: detector.level, file, line: index + 1, match: line.trim().slice(0, MATCH_CAP) });
      });
    }
  }

  const named = new Set(findings.map((finding) => finding.rule));
  const rules = options.rules
    .filter((rule) => named.has(rule.id))
    .map((rule): CheckedRule => {
      const triage = rule.detectors.find((detector): detector is RgDetector => detector.kind === "rg" && detector.triage !== undefined)?.triage;
      return { id: rule.id, statement: rule.statement, rationale: rule.rationale.chunk, ...(triage === undefined ? {} : { triage }) };
    });
  return ok({ findings, rules, scanned });
}
