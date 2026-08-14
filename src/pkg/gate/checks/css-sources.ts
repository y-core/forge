import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { type CheckResult, checkResult, type Finding, fail } from "../finding";
import { findClassDeclarations, findSourceDirectives } from "./css-parse";

/** What the `@source` coverage check needs to know about the project. @public */
export interface CssSourcesCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** The component root whose every subdirectory must be scanned or registered, relative to `root`. */
  uiDir: string;
  /** Directory of stylesheets whose `@source` directives are read, relative to `root`. */
  cssDir: string;
  /** Source root swept by pass C for class-bearing siblings, relative to `root`. */
  sourceDir: string;
  /** README that must publish each `consumerScanned` line verbatim, relative to `root`. */
  readme: string;
  /** Directories under `uiDir` that emit no utility class, each mapped to the reason — a claim pass B re-checks. */
  classFree?: ReadonlyMap<string, string>;
  /** Directories under `uiDir` that declare classes but are opt-in, each mapped to the exact `@source` line an app must add. */
  consumerScanned?: ReadonlyMap<string, string>;
}

const SKIP_FILE = (name: string): boolean => name.endsWith(".test.ts") || name.endsWith(".test.tsx") || name.endsWith(".browser.ts");

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSources(full));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !SKIP_FILE(entry.name)) out.push(full);
  }
  return out;
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
  for (const entry of readdirSync(cssDir).sort()) {
    if (!entry.endsWith(".css")) continue;
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

  let registered = 0;
  for (const entry of readdirSync(ui, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const abs = resolve(ui, entry.name);
    const dir = `${config.uiDir}/${entry.name}`;
    registered++;

    if (isScanned(abs) || classFree.has(entry.name)) continue;

    const line = consumerScanned.get(entry.name);
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
          `Add \`@source "../../${entry.name}";\` to the stylesheet if its files declare utility classes and every app needs them,`,
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
  for (const entry of readdirSync(ui, { withFileTypes: true })) {
    if (entry.isFile() && /\.tsx?$/.test(entry.name) && !SKIP_FILE(entry.name)) suspects.push(resolve(ui, entry.name));
  }

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

  for (const entry of readdirSync(src, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const abs = resolve(src, entry.name);
    if (abs === ui || ui.startsWith(abs + sep)) continue;

    const declaring = collectSources(abs)
      .sort()
      .filter((file) => findClassDeclarations(readFileSync(file, "utf-8")).length > 0);
    if (declaring.length === 0) continue;

    const readme = resolve(abs, "README.md");
    if (existsSync(readme) && readFileSync(readme, "utf-8").includes("@source")) continue;

    findings.push(
      fail("renders utility classes, but its README.md never mentions @source", {
        file: `${config.sourceDir}/${entry.name}`,
        detail: [
          ...declaring.map((file) => relative(root, file)),
          `The stylesheet scans ${config.uiDir}/ only, so these classes are the consuming app's to scan.`,
          `Say so in ${config.sourceDir}/${entry.name}/README.md, where someone adopting this surface reads it.`,
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
