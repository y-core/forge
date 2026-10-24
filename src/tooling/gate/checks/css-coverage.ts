import { readFileSync } from "node:fs";
import { dirname, posix, relative, resolve, sep } from "node:path";

import { cssSourceMatches, isCssSourceCovered, readCssDeclaration } from "../../assets/css-declaration";
import { worktreeFiles } from "../../cli/worktree";
import { checkResult, fail, scannedNothing, warn } from "../finding";
import type { CheckResult, Finding } from "../types";
import { findClassDeclarations } from "./css-parse";
import { excludedBy, isTestSource } from "./source-scan";
import type { CssCoverageCheckConfig } from "./types";

const isScannedSource = (path: string): boolean => /\.tsx?$/.test(path) && !isTestSource(path);

const toPosix = (path: string): string => path.split(sep).join(posix.sep);

function withinSources(file: string, sources: readonly string[]): boolean {
  const entries = sources.map((entry) => entry.replace(/^(!?)\.\//, "$1").replace(/\/+$/, ""));
  const excluded = entries.filter((entry) => entry.startsWith("!")).map((entry) => entry.slice(1));
  const included = entries.filter((entry) => !entry.startsWith("!"));
  const inside = included.some((entry) => entry === "" || entry === "." || file === entry || file.startsWith(`${entry}/`));
  return inside && !excludedBy(file, excluded);
}

function suggestedSource(entryDir: string, file: string): string {
  const path = toPosix(relative(entryDir, dirname(file)));
  if (path === "") return ".";
  return path.startsWith(".") ? path : `./${path}`;
}

/** Fails automatic source detection and every class-declaring source file no `@source` covers; warns on a classless scanned directory. @public */
export async function checkCssCoverage(config: CssCoverageCheckConfig): Promise<CheckResult> {
  const { root, stylesheet, sources } = config;
  const files = worktreeFiles(root);
  if (files === undefined) {
    return checkResult([fail("is not inside a git work tree, so there is no file list to match `@source` against", { file: "." })], "");
  }

  const candidates = files.filter((file) => isScannedSource(file) && withinSources(file, sources));
  if (candidates.length === 0) return scannedNothing(`\`${sources.join("`, `")}\` matched no source`, "css-coverage");

  const entry = resolve(root, stylesheet);
  const declaration = await readCssDeclaration(entry);
  const findings: Finding[] = [];

  if (declaration.root !== "none") {
    findings.push(
      fail("automatic source detection is on, so a file no `@source` names is still scanned and the gap stays hidden", {
        file: stylesheet,
        detail: ['import Tailwind with `@import "tailwindcss" source(none);` and name every scanned path with `@source`'],
      }),
    );
  }

  const declares = new Map<string, boolean>();
  const declaresClasses = (file: string): boolean => {
    const known = declares.get(file);
    if (known !== undefined) return known;
    const found = findClassDeclarations(readFileSync(resolve(root, file), "utf-8")).length > 0;
    declares.set(file, found);
    return found;
  };
  const covered = (file: string): boolean => isCssSourceCovered(declaration.sources, resolve(root, file));

  for (const file of candidates) {
    if (!declaresClasses(file) || covered(file)) continue;
    findings.push(
      fail("declares utility classes, but no `@source` covers it, so Tailwind generates none of them", {
        file,
        detail: [`add to ${stylesheet}: @source "${suggestedSource(dirname(entry), resolve(root, file))}";`],
      }),
    );
  }

  for (const source of declaration.sources) {
    if (source.negated) continue;
    const scanned = files.filter((file) => isScannedSource(file) && cssSourceMatches(source, resolve(root, file)) && covered(file));
    if (scanned.length === 0 || scanned.some(declaresClasses)) continue;
    findings.push(
      warn("is scanned by `@source`, but no source file it matches declares a utility class — scan breadth to cut", {
        file: toPosix(relative(root, resolve(source.base, source.pattern))),
        detail: [`@source "${source.pattern}" in ${toPosix(relative(root, source.base)) || "."}/`],
      }),
    );
  }

  const scope = `${candidates.length} source files against ${declaration.sources.length} \`@source\` declarations`;
  const failed = findings.some((finding) => finding.level === "fail");
  return checkResult(findings, failed ? scope : `${scope}: automatic detection is off and every class-declaring file is covered`);
}
