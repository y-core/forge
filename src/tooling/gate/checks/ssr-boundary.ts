import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { parseImports, resolveSpecifier } from "./namespace-graph-parse";
import { collectFiles } from "./source-scan";
import type { SsrBoundaryCheckConfig } from "./types";

const MODULE_EXTENSIONS = [".ts", ".tsx"] as const;

// A spec is not shipped, and a `.browser.ts` spec's whole job is to drive the client runtime.
const SCANNED = (name: string): boolean => MODULE_EXTENSIONS.some((ext) => name.endsWith(ext)) && !/\.(test|browser)\.tsx?$/.test(name);

/** Whether `file` is itself inside a client directory, and so may import freely within any. */
function isClientOwned(file: string, clientDirs: readonly string[]): boolean {
  return clientDirs.some((dir) => file === dir || file.startsWith(`${dir}/`));
}

/** Why `file` may not import from the client directory, or `null` when it may. @public */
export function boundaryViolation(file: string, config: Pick<SsrBoundaryCheckConfig, "clientDirs" | "entryPoints">): string | null {
  const base = file.slice(file.lastIndexOf("/") + 1);
  if (isClientOwned(file, config.clientDirs)) return null;
  // A `.tsx` file renders markup, so it runs in the Worker by definition — no entry-point exemption
  // reaches it, which is what stops a component quietly gaining a browser import.
  if (file.endsWith(".tsx")) return "a `.tsx` file renders on the server, so it may never import the browser runtime";
  if (config.entryPoints.includes(base)) return null;
  return `only ${config.entryPoints.map((name) => `\`${name}\``).join(" / ")} may import the browser runtime from outside ${config.clientDirs.map((dir) => `\`${dir}\``).join(" / ")}`;
}

/** Judges one file's imports against the boundary. @public */
export function validateSsrBoundary(file: string, source: string, config: Pick<SsrBoundaryCheckConfig, "clientDirs" | "entryPoints">): Finding[] {
  const reason = boundaryViolation(file, config);
  if (reason === null) return [];

  const crossings = parseImports(source).flatMap((ref) => {
    // Type-only imports are erased at emit, so they cannot drag browser code into a Worker bundle.
    if (ref.kind === "type") return [];
    const target = resolveSpecifier(file, ref.specifier);
    if (target === null || !isClientOwned(target, config.clientDirs)) return [];
    return [`line ${ref.line}: \`${ref.specifier}\``];
  });

  if (crossings.length === 0) return [];
  return [fail("SSR boundary crossed", { file, detail: [reason, ...crossings] })];
}

/** Walks the configured sources and reports every file that imports the browser runtime it may not. @public */
export function checkSsrBoundary(config: SsrBoundaryCheckConfig): CheckResult {
  const files = config.sources.flatMap((dir) => collectFiles(config.root, dir, SCANNED));
  if (files.length === 0) return scannedNothing(`\`${config.sources.join("`, `")}\` matched no source`, "ssr-boundary");

  const findings = files.flatMap((file) => validateSsrBoundary(file, readFileSync(resolve(config.root, file), "utf-8"), config));

  return checkResult(findings, `${files.length} files respect the ${config.clientDirs.join(", ")} boundary`);
}
