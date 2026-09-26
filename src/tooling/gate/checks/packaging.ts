import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { collectFiles, isTestSource, unresolvedSourceEntries } from "./source-scan";
import type { PackagingCheckConfig } from "./types";

const MODULE_EXTENSIONS = [".ts", ".tsx"] as const;

// Both spellings: a lazily loaded module is reached by `import("./x")` and by nothing else.
const RELATIVE_SPECIFIER = /(?:from\s+|import\s*\(\s*)["'](\.[^"']*)["']/g;

/** One `files` entry as a matcher over a repo-relative posix path. */
function toMatcher(pattern: string): (file: string) => boolean {
  const source = pattern
    .split("**/")
    .map((part) => part.replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`).replaceAll("*", "[^/]*"))
    .join("(?:.*/)?");
  const expression = new RegExp(`^${source}$`);
  return (file) => expression.test(file);
}

/** Whether `npm pack` would carry `file`: each `files` entry in order, a negation undoing an include. */
function isPacked(file: string, patterns: readonly string[]): boolean {
  let packed = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const body = negated ? pattern.slice(1) : pattern;
    const matches = body.endsWith("/") ? file.startsWith(body) : toMatcher(body)(file);
    if (matches) packed = !negated;
  }
  return packed;
}

function resolveSpecifier(from: string, specifier: string, present: ReadonlySet<string>): string | undefined {
  const stack: string[] = [];
  for (const part of `${from.slice(0, from.lastIndexOf("/"))}/${specifier}`.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const base = stack.join("/");
  return [base, ...MODULE_EXTENSIONS.map((ext) => `${base}${ext}`), `${base}/mod.ts`].find((candidate) => present.has(candidate));
}

/** Every walked module a relative specifier in `file` names. @public */
export function moduleImports(root: string, file: string, present: ReadonlySet<string>): string[] {
  const source = readFileSync(resolve(root, file), "utf-8");
  const out: string[] = [];
  for (const match of source.matchAll(RELATIVE_SPECIFIER)) {
    const resolved = resolveSpecifier(file, match[1] ?? "", present);
    if (resolved !== undefined) out.push(resolved);
  }
  return out;
}

/** The entry modules the `exports` map names, repo-relative. */
function entryModules(config: PackagingCheckConfig, present: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const value of Object.values(config.exports)) {
    const target = typeof value === "string" ? value : (value.import ?? value.types);
    if (target === undefined) continue;
    const file = target.replace(/^\.\//, "");
    if (present.has(file)) out.push(file);
  }
  for (const entry of config.entries ?? []) {
    const file = entry.replace(/^\.\//, "");
    if (present.has(file)) out.push(file);
  }
  return out;
}

/** The name the convention gives a module only a test reaches. @public */
export function fixtureName(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const ext = base.endsWith(".tsx") ? ".tsx" : ".ts";
  return `${base.slice(0, -ext.length)}.fixture${ext}`;
}

/** A finding for each required file that is missing on disk or that the `files` array leaves out. */
function missingRequired(config: PackagingCheckConfig): Finding[] {
  return (config.required ?? []).flatMap((file) => {
    if (!existsSync(resolve(config.root, file))) return [fail("a file the tarball must carry does not exist", { file })];
    if (!isPacked(file, config.files))
      return [fail("a file the tarball must carry is left out by the `files` array", { file, detail: [`add \`${file}\` to \`files\``] })];
    return [];
  });
}

/** Reports every module only a test reaches that the published tarball would still carry, and every required file it would lack. @public */
export function checkPackaging(config: PackagingCheckConfig): CheckResult {
  const sources = config.sources ?? ["src"];
  const walked = sources.flatMap((dir) => collectFiles(config.root, dir, (name) => MODULE_EXTENSIONS.some((ext) => name.endsWith(ext))));
  if (walked.length === 0) return scannedNothing(`\`${sources.join("`, `")}\` matched no module`, "packaging");
  const unresolved = unresolvedSourceEntries(config.root, sources);
  if (unresolved.length > 0) return checkResult(unresolved, "");

  const present = new Set(walked);
  const imports = new Map(walked.map((file) => [file, moduleImports(config.root, file, present)]));

  // Reachability from the exports map, not importer counts: a barrel is imported by tests alone and
  // is still the published surface, while a test-only module is what nothing consumable reaches.
  const reachable = new Set<string>();
  const queue = entryModules(config, present);
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (reachable.has(file)) continue;
    reachable.add(file);
    queue.push(...(imports.get(file) ?? []));
  }

  const importers = new Map<string, string[]>();
  for (const [file, imported] of imports) {
    for (const target of imported) importers.set(target, [...(importers.get(target) ?? []), file]);
  }

  const findings: Finding[] = [
    ...missingRequired(config),
    ...walked
      .filter((file) => !isTestSource(file) && !reachable.has(file) && (importers.get(file) ?? []).length > 0)
      .filter((file) => isPacked(file, config.files))
      .map((file) =>
        fail("no published subpath reaches this module — only a test does, and the tarball still carries it", {
          file,
          detail: [
            `imported by: ${(importers.get(file) ?? []).join(", ")}`,
            `rename it \`${fixtureName(file)}\` — the \`files\` array excludes every \`*.fixture.ts\` and nothing else`,
          ],
        }),
      ),
  ];

  return checkResult(findings, `${reachable.size} of ${walked.length} modules are reachable from a published subpath`);
}
