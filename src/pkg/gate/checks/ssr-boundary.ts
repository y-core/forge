import { readdirSync, readFileSync } from "node:fs";
import { posix, relative, resolve, sep } from "node:path";
import { type CheckResult, checkResult, type Finding, fail } from "../finding";
import { parseImports, resolveSpecifier } from "./namespace-graph-parse";

/** What the SSR-boundary check needs to know about the project. @public */
export interface SsrBoundaryCheckConfig {
  /** Repository root; every reported path is relative to it. */
  root: string;
  /** The browser-only directory, relative to `root` — nothing outside it may import from within it. */
  clientDir: string;
  /** Directories walked for source files, relative to `root`. */
  sources: readonly string[];
  /** Basenames permitted to cross the boundary; the registration entry points. */
  entryPoints: readonly string[];
}

const MODULE_EXTENSIONS = [".ts", ".tsx"] as const;

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!MODULE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    // A spec is not shipped, and a `.browser.ts` spec's whole job is to drive the client runtime.
    if (/\.(test|browser)\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

/** Whether `file` is itself inside the client directory, and so may import freely within it. */
function isClientOwned(file: string, clientDir: string): boolean {
  return file === clientDir || file.startsWith(`${clientDir}/`);
}

/** Why `file` may not import from the client directory, or `null` when it may. @public */
export function boundaryViolation(file: string, config: Pick<SsrBoundaryCheckConfig, "clientDir" | "entryPoints">): string | null {
  const base = file.slice(file.lastIndexOf("/") + 1);
  if (isClientOwned(file, config.clientDir)) return null;
  // A `.tsx` file renders markup, so it runs in the Worker by definition — no entry-point exemption
  // reaches it, which is what stops a component quietly gaining a browser import.
  if (file.endsWith(".tsx")) return "a `.tsx` file renders on the server, so it may never import the browser runtime";
  if (config.entryPoints.includes(base)) return null;
  return `only ${config.entryPoints.map((name) => `\`${name}\``).join(" / ")} may import the browser runtime from outside \`${config.clientDir}\``;
}

/** Judges one file's imports against the boundary. @public */
export function validateSsrBoundary(file: string, source: string, config: Pick<SsrBoundaryCheckConfig, "clientDir" | "entryPoints">): Finding[] {
  const reason = boundaryViolation(file, config);
  if (reason === null) return [];

  const crossings = parseImports(source).flatMap((ref) => {
    // Type-only imports are erased at emit, so they cannot drag browser code into a Worker bundle.
    if (ref.kind === "type") return [];
    const target = resolveSpecifier(file, ref.specifier);
    if (target === null || !isClientOwned(target, config.clientDir)) return [];
    return [`line ${ref.line}: \`${ref.specifier}\``];
  });

  if (crossings.length === 0) return [];
  return [fail("SSR boundary crossed", { file, detail: [reason, ...crossings] })];
}

/** Walks the configured sources and reports every file that imports the browser runtime it may not. @public */
export function checkSsrBoundary(config: SsrBoundaryCheckConfig): CheckResult {
  const toPosix = (path: string) => relative(config.root, path).split(sep).join(posix.sep);
  const files = config.sources.flatMap((dir) => collectSources(resolve(config.root, dir)));

  const findings = files.flatMap((absolute) => {
    const file = toPosix(absolute);
    return validateSsrBoundary(file, readFileSync(absolute, "utf-8"), config);
  });

  return checkResult(findings, `${files.length} files respect the ${config.clientDir} boundary`);
}
