import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { findClassDeclarations, findSourceDirectives } from "./css-parse";
import { collectFiles, listDirectories, listFiles } from "./source-scan";
import type { CssSourcesCheckConfig } from "./types";

const SKIP_FILE = (name: string): boolean => name.endsWith(".test.ts") || name.endsWith(".test.tsx") || name.endsWith(".browser.ts");

function collectSources(dir: string): string[] {
  return collectFiles(dir, ".", (name) => /\.tsx?$/.test(name) && !SKIP_FILE(name)).map((file) => resolve(dir, file));
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
              `The stylesheet scans ${config.uiDir}/ and nothing else. A namespace outside it documents its own`,
              "@source requirement in its README for the consuming app to honour instead.",
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
  for (const name of listFiles(ui, (file) => /\.tsx?$/.test(file) && !SKIP_FILE(file))) suspects.push(resolve(ui, name));

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

  for (const name of listDirectories(src)) {
    const abs = resolve(src, name);
    if (abs === ui || ui.startsWith(abs + sep)) continue;

    const declaring = collectSources(abs)
      .sort()
      .filter((file) => findClassDeclarations(readFileSync(file, "utf-8")).length > 0);
    if (declaring.length === 0) continue;

    const readme = resolve(abs, "README.md");
    if (existsSync(readme) && readFileSync(readme, "utf-8").includes("@source")) continue;

    findings.push(
      fail("renders utility classes, but its README.md never mentions @source", {
        file: `${config.sourceDir}/${name}`,
        detail: [
          ...declaring.map((file) => relative(root, file)),
          `The stylesheet scans ${config.uiDir}/ only, so these classes are the consuming app's to scan.`,
          `Say so in ${config.sourceDir}/${name}/README.md, where someone adopting this surface reads it.`,
        ],
      }),
    );
  }

  if (findings.some((finding) => finding.level === "fail")) {
    findings.push(fail("Every utility class the library emits must be textually visible to a consumer's Tailwind scan."));
  }

  return checkResult(
    findings,
    `${registered} ${config.uiDir} directories are @source-scanned or registered, and no class string hides behind one.`,
  );
}
