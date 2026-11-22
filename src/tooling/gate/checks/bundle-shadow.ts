import { existsSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { blankSourceComments, collectFiles, lineAt, resolveSources, unresolvedSourceEntries } from "./source-scan";
import type { BundleShadowCheckConfig } from "./types";

const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'`])(\.{1,2}\/[^"'`$]*)\1/g;

const MODULE_EXTENSION = /\.(?:[cm]?[jt]sx?|json)$/;

// Bun 1.4.4's order inside `node_modules`: each of these is loaded ahead of a `.ts` with the same stem.
const SHADOWING_EXTENSIONS = [".mjs", ".js", ".cjs"] as const;

/** The `.mjs`, `.js` and `.cjs` files an extensionless `specifier` imported from `file` could load, repo-relative. @internal */
export function shadowCandidates(file: string, specifier: string): string[] {
  if (MODULE_EXTENSION.test(specifier)) return [];
  const target = posix.normalize(posix.join(posix.dirname(file), specifier));
  return [...SHADOWING_EXTENSIONS.map((ext) => `${target}${ext}`), ...SHADOWING_EXTENSIONS.map((ext) => `${target}/index${ext}`)];
}

/** The findings for one source file's relative imports that reach a `.mjs`, `.js` or `.cjs` under `root`. @public */
export function validateBundleShadows(
  root: string,
  file: string,
  source: string,
  exists: (path: string) => boolean = (path) => existsSync(resolve(root, path)),
): Finding[] {
  const shadowOf = (match: RegExpMatchArray) => shadowCandidates(file, match[2] ?? "").find(exists);
  if (![...source.matchAll(RELATIVE_SPECIFIER)].some((match) => shadowOf(match) !== undefined)) return [];
  const findings: Finding[] = [];
  for (const match of blankSourceComments(source).matchAll(RELATIVE_SPECIFIER)) {
    const specifier = match[2] ?? "";
    const shadow = shadowOf(match);
    if (shadow === undefined) continue;
    findings.push(
      fail(`\`${specifier}\` resolves to \`${shadow}\` under Bun, not to the \`.ts\` source beside it`, {
        file,
        line: lineAt(source, match.index),
        detail: [
          "Bun loads a `.mjs`, `.js` or `.cjs` ahead of the `.ts` for an extensionless import inside `node_modules`, so the module runs twice with separate state",
          `rename it \`${posix.basename(shadow, posix.extname(shadow))}.node${posix.extname(shadow)}\`, which no extensionless specifier can reach`,
        ],
      }),
    );
  }
  return findings;
}

/** A membership test over every `.mjs`, `.js` and `.cjs` under `root`, indexed once per top-level directory a path names. */
function shadowingFiles(root: string): (path: string) => boolean {
  const indexed = new Map<string, ReadonlySet<string>>();
  const accept = (name: string) => SHADOWING_EXTENSIONS.some((ext) => name.endsWith(ext));
  return (path) => {
    const slash = path.indexOf("/");
    if (slash === -1 || path.startsWith("../")) return existsSync(resolve(root, path));
    const dir = path.slice(0, slash);
    const files = indexed.get(dir) ?? new Set(collectFiles(root, dir, accept));
    indexed.set(dir, files);
    return files.has(path);
  };
}

/** Checks that no extensionless relative import in `sources` reaches a `.mjs`, `.js` or `.cjs` file. @public */
export function checkBundleShadows(config: BundleShadowCheckConfig): CheckResult {
  const unresolved = unresolvedSourceEntries(config.root, config.sources);
  if (unresolved.length > 0) return checkResult(unresolved, "");
  const files = resolveSources(config.root, config.sources, (name) => name.endsWith(".ts") || name.endsWith(".tsx"));
  if (files.length === 0) return scannedNothing(`\`${config.sources.join("`, `")}\` matched no \`.ts\` or \`.tsx\` file`, "bundle-shadow");

  const exists = shadowingFiles(config.root);
  const findings = files.flatMap((file) => validateBundleShadows(config.root, file, readFileSync(resolve(config.root, file), "utf-8"), exists));
  return checkResult(findings, `no relative import in ${files.length} source files reaches a \`.mjs\`, \`.js\` or \`.cjs\``);
}
