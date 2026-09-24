import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { collectFiles, isTestSource, unresolvedSourceEntries } from "./source-scan";
import type { JsxCheckConfig } from "./types";

const DEFAULT_PRAGMAS = ["@jsxRuntime automatic", "@jsxImportSource @y-core/forge/jsx"] as const;

/** The `.tsx` files the check will judge, as absolute paths. @public */
export function resolveJsxSources(config: JsxCheckConfig): string[] {
  const sources = config.sources ?? ["src"];
  const accept = (name: string): boolean => name.endsWith(".tsx") && !isTestSource(name);
  return sources.flatMap((dir) => collectFiles(config.root, dir, accept)).map((file) => resolve(config.root, file));
}

/** Judges one file's source against the pragma rule. @public */
export function validateJsxSource(file: string, source: string, pragmas: readonly string[] = DEFAULT_PRAGMAS): Finding[] {
  const missing = pragmas.filter((pragma) => !source.includes(pragma));
  if (missing.length === 0) return [];

  return [fail("JSX contract violated", { file, detail: missing.map((pragma) => `missing: /** ${pragma} */`) })];
}

/** Walk the configured sources and judge every `.tsx` file in them. @public */
export function checkJsx(config: JsxCheckConfig): CheckResult {
  const pragmas = config.pragmas ?? DEFAULT_PRAGMAS;
  const files = resolveJsxSources(config);
  if (files.length === 0) return scannedNothing(`\`${(config.sources ?? ["src"]).join("`, `")}\` matched no \`.tsx\` file`, "jsx");
  const unresolved = unresolvedSourceEntries(config.root, config.sources ?? ["src"]);
  if (unresolved.length > 0) return checkResult(unresolved, "");

  const findings = files.flatMap((file) => validateJsxSource(relative(config.root, file), readFileSync(file, "utf-8"), pragmas));

  if (findings.length > 0) {
    findings.push(fail("Each shipped .tsx file must carry every JSX pragma line."));
  }

  return checkResult(findings, `${files.length} .tsx files carry every JSX pragma.`);
}
