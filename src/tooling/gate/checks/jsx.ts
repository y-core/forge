import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { type CheckResult, checkResult, type Finding, fail, scannedNothing } from "../finding";
import { collectFiles } from "./source-scan";

/** What the JSX check needs to know about the project. @public */
export interface JsxCheckConfig {
  /** Repository root; every reported path is relative to it. */
  root: string;
  /** Directories walked for `.tsx` files, relative to `root`. Defaults to `["src"]`. */
  sources?: readonly string[];
  /** Pragma lines every shipped `.tsx` file must contain, matched as substrings; defaults to forge's own pair. */
  pragmas?: readonly string[];
}

const DEFAULT_PRAGMAS = ["@jsxRuntime automatic", "@jsxImportSource @y-core/forge/jsx"] as const;

/** The `.tsx` files the check will judge, as absolute paths. @public */
export function resolveJsxSources(config: JsxCheckConfig): string[] {
  const sources = config.sources ?? ["src"];
  const accept = (name: string): boolean => name.endsWith(".tsx") && !name.endsWith(".test.tsx");
  return sources.flatMap((dir) => collectFiles(config.root, dir, accept)).map((file) => resolve(config.root, file));
}

// The ordering half of the JSX contract — a literal `data-slot` a later spread clobbers — is
// `forge/data-slot-before-spread`, an oxlint rule. What is left here is a file-presence check, which
// no per-node rule can state.
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

  const findings = files.flatMap((file) => validateJsxSource(relative(config.root, file), readFileSync(file, "utf-8"), pragmas));

  if (findings.length > 0) {
    findings.push(fail("Each shipped .tsx file must carry every JSX pragma line."));
  }

  return checkResult(findings, `${files.length} .tsx files carry every JSX pragma.`);
}
