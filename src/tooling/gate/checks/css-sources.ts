import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { findClassDeclarations, findSourceDirectives } from "./css-parse";
import { collectFiles, isTestSource, listDirectories, listFiles } from "./source-scan";
import type { CssSourcesCheckConfig, ExportsMap } from "./types";

function collectSources(dir: string): string[] {
  return collectFiles(dir, ".", (name) => /\.tsx?$/.test(name) && !isTestSource(name)).map((file) => resolve(dir, file));
}

function findNearestDir(start: string, stop: string, holds: string): string | undefined {
  for (let dir = start; dir !== stop && dirname(dir) !== dir; dir = dirname(dir)) {
    if (existsSync(resolve(dir, holds))) return dir;
  }
  return undefined;
}

function exportsTo(entry: ExportsMap[string] | undefined, target: string): boolean {
  if (entry === undefined) return false;
  if (typeof entry === "string") return entry === target;
  return entry.import === target;
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function appendTo(groups: Map<string, string[]>, key: string, file: string): void {
  groups.set(key, [...(groups.get(key) ?? []), file]);
}

/** Run all three passes. @public */
export function checkCssSources(config: CssSourcesCheckConfig): CheckResult {
  const { root } = config;
  const ui = resolve(root, config.uiDir);
  const cssDir = resolve(root, config.cssDir);
  const src = resolve(root, config.sourceDir);
  const classFree = config.classFree ?? new Map<string, string>();
  const consumerScanned = config.consumerScanned ?? new Map<string, string>();
  const findings: Finding[] = [];

  const scanned: string[] = [];
  for (const entry of listFiles(cssDir, (name) => name.endsWith(".css"))) {
    for (const source of findSourceDirectives(readFileSync(resolve(cssDir, entry), "utf-8"))) {
      const abs = resolve(cssDir, source);
      if (abs !== ui && !abs.startsWith(ui + sep)) {
        findings.push(
          fail(`@source "${source}" resolves outside ${config.uiDir}/ (${relative(root, abs)})`, {
            file: `${config.cssDir}/${entry}`,
            detail: [
              `The stylesheet scans ${config.uiDir}/ and nothing else. A namespace outside it ships its own`,
              "`sources.css` for the consuming app to import instead.",
            ],
          }),
        );
        continue;
      }
      scanned.push(abs);
    }
  }

  const isScanned = (dir: string): boolean => scanned.some((s) => dir === s || dir.startsWith(s + sep));
  const readmeText = existsSync(resolve(root, config.readme)) ? readFileSync(resolve(root, config.readme), "utf-8") : "";

  const uiDirs = listDirectories(ui);
  if (uiDirs.length === 0) return scannedNothing(`\`${config.uiDir}\` holds no directory`, "css-sources");

  let registered = 0;
  for (const name of uiDirs) {
    const abs = resolve(ui, name);
    const dir = `${config.uiDir}/${name}`;
    registered++;

    if (isScanned(abs) || classFree.has(name)) continue;

    const line = consumerScanned.get(name);
    if (line !== undefined) {
      if (!readmeText.includes(line)) {
        findings.push(
          fail(`is opt-in, but ${config.readme} does not publish the line an app must add`, {
            file: dir,
            detail: [
              `Expected verbatim: ${line}`,
              "Without it the directory's markup renders with every class unstyled, and nothing else would say so.",
            ],
          }),
        );
      }
      continue;
    }

    findings.push(
      fail(`no @source path in ${config.cssDir}/ covers it, and it is registered nowhere`, {
        file: dir,
        detail: [
          `Add \`@source "../../${name}";\` to the stylesheet if its files declare utility classes and every app needs them,`,
          "or register it class-free with the reason it declares none,",
          "or register it consumer-scanned if it is an opt-in surface the app scans itself.",
        ],
      }),
    );
  }

  const suspects: string[] = [];
  for (const name of classFree.keys()) {
    const abs = resolve(ui, name);
    try {
      if (statSync(abs).isDirectory()) suspects.push(...collectSources(abs));
    } catch {
      findings.push(fail(`registered class-free, but does not exist on disk`, { file: `${config.uiDir}/${name}` }));
    }
  }
  for (const name of listFiles(ui, (file) => /\.tsx?$/.test(file) && !isTestSource(file))) suspects.push(resolve(ui, name));

  for (const file of suspects.sort()) {
    for (const { literal, anchors } of findClassDeclarations(readFileSync(file, "utf-8"))) {
      findings.push(
        fail(`string literal declares utility classes — ${anchors.join(" ")}`, {
          file: relative(root, file),
          detail: [
            `in: ${literal.length > 120 ? `${literal.slice(0, 120)}…` : literal}`,
            "Either move the declaration into an @source-scanned directory, or drop this",
            "directory from the class-free registry and give it an @source path.",
          ],
        }),
      );
    }
  }

  const unshipped = new Map<string, string[]>();
  const shipped = new Map<string, string[]>();
  for (const name of listDirectories(src)) {
    const abs = resolve(src, name);
    if (abs === ui || ui.startsWith(abs + sep)) continue;

    for (const file of collectSources(abs).sort()) {
      if (findClassDeclarations(readFileSync(file, "utf-8")).length === 0) continue;
      const home = findNearestDir(dirname(file), src, "sources.css");
      if (home !== undefined) appendTo(shipped, home, file);
      else appendTo(unshipped, findNearestDir(dirname(file), src, "mod.ts") ?? dirname(file), file);
    }
  }

  for (const [dir, files] of unshipped) {
    const at = toPosix(relative(root, dir));
    findings.push(
      fail("renders utility classes, but no sources.css above it ships them to the consuming app", {
        file: at,
        detail: [
          ...files.map((file) => toPosix(relative(root, file))),
          `Ship ${at}/sources.css with \`@source "./";\`, export it from package.json,`,
          `and put its \`@import\` line in ${at}/README.md.`,
        ],
      }),
    );
  }

  for (const [home, files] of shipped) {
    const ns = toPosix(relative(src, home));
    const at = `${config.sourceDir}/${ns}`;
    const sources = findSourceDirectives(readFileSync(resolve(home, "sources.css"), "utf-8")).map((source) => resolve(home, source));
    const uncovered = files.filter((file) => !sources.some((s) => dirname(file) === s || dirname(file).startsWith(s + sep)));
    if (uncovered.length > 0) {
      findings.push(
        fail("its sources.css does not cover every class-declaring file under it", {
          file: at,
          detail: [...uncovered.map((file) => toPosix(relative(root, file))), `Add an @source path to ${at}/sources.css that reaches them.`],
        }),
      );
    }

    const subpath = `./${ns}/sources.css`;
    const target = `./${at}/sources.css`;
    if (!exportsTo(config.exports[subpath], target)) {
      findings.push(
        fail(`its sources.css is not exported as "${subpath}"`, { file: at, detail: [`Map "${subpath}" to "${target}" in package.json exports.`] }),
      );
    }

    const line = `@import "${config.packageName}/${ns}/sources.css"`;
    const readme = resolve(home, "README.md");
    if (!existsSync(readme) || !readFileSync(readme, "utf-8").includes(line)) {
      findings.push(
        fail("its README.md does not publish the line that imports its sources.css", { file: at, detail: [`Expected verbatim: ${line}`] }),
      );
    }
  }

  if (findings.some((finding) => finding.level === "fail")) {
    findings.push(fail("Every utility class the library emits must be textually visible to a consumer's Tailwind scan."));
  }

  return checkResult(
    findings,
    `${registered} ${config.uiDir} directories are @source-scanned or registered, and no class string hides behind one.`,
  );
}
