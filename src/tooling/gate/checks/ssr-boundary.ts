import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { parseImports, resolveSpecifier } from "./namespace-graph-parse";
import { collectFiles, isTestSource } from "./source-scan";
import type { SsrBoundaryCheckConfig } from "./types";

const MODULE_EXTENSIONS = [".ts", ".tsx"] as const;

/** What judging one file needs: the boundary itself, plus the manifest a bare self-import is read against. */
type SsrBoundaryConfig = Pick<SsrBoundaryCheckConfig, "clientDirs" | "entryPoints" | "packageName" | "exports">;

const SCANNED = (name: string): boolean => MODULE_EXTENSIONS.some((ext) => name.endsWith(ext)) && !isTestSource(name);

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

/** Every published subpath that reaches the browser runtime, as a consumer would spell it. @public */
export function clientSubpaths(config: SsrBoundaryConfig): Map<string, string> {
  const found = new Map<string, string>();
  if (config.packageName === undefined || config.exports === undefined) return found;
  for (const [subpath, value] of Object.entries(config.exports)) {
    const target = typeof value === "string" ? value : (value.import ?? value.types);
    if (target === undefined) continue;
    const normalized = target.startsWith("./") ? target.slice(2) : target;
    const base = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (!isClientOwned(normalized, config.clientDirs) && !config.entryPoints.includes(base)) continue;
    found.set(`${config.packageName}${subpath.slice(1)}`, normalized);
  }
  return found;
}

/** Judges one file's imports against the boundary. @public */
export function validateSsrBoundary(file: string, source: string, config: SsrBoundaryConfig): Finding[] {
  const reason = boundaryViolation(file, config);
  if (reason === null) return [];

  const published = clientSubpaths(config);
  const crossings = parseImports(source).flatMap((ref) => {
    // Type-only imports are erased at emit, so they cannot drag browser code into a Worker bundle.
    if (ref.kind === "type") return [];
    const target = resolveSpecifier(file, ref.specifier);
    // A self-import by package name resolves to nothing relative, so the published subpath list is
    // the only thing that can tell it from a third party's.
    if (target === null) return published.has(ref.specifier) ? [`line ${ref.line}: \`${ref.specifier}\``] : [];
    if (!isClientOwned(target, config.clientDirs)) return [];
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
