import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { type CheckResult, checkResult, type Finding, fail } from "../finding";
import type { ExportsMap } from "./exports";
import { buildGraph, type DeclaredGraph, diffGraph, findEnumerations, type SourceFile } from "./namespace-graph-parse";

/** What the namespace-graph check needs to know about the project. @public */
export interface NamespaceGraphCheckConfig {
  /** Application root. */
  root: string;
  /** The `exports` map, verbatim from `package.json` — the namespace set is *derived* from it. */
  exports: ExportsMap;
  /** The declared graph: primitives, leaf namespaces, and every edge with its kind. */
  graph: DeclaredGraph;
  /** Source root walked for imports, relative to `root`. Defaults to `"src"`. */
  sourceDir?: string;
  /** Unpublished barrels that are still namespaces for layering purposes. */
  sealedInternal?: readonly string[];
  /** Governing document guarded against a returning enumeration, relative to `root`; omit to skip check 3. */
  enumerationDoc?: string;
}

/** The directory of every `mod.ts` the exports map names, plus the sealed-internal barrels. @public */
export function resolveNamespaces(map: ExportsMap, sealedInternal: readonly string[] = [], sourceDir = "src"): string[] {
  const dirs = new Set<string>();
  const targets = Object.values(map)
    .map((entry) => (typeof entry === "string" ? entry : (entry.import ?? entry.types)))
    .filter((target): target is string => target !== undefined);

  const prefix = `${sourceDir}/`;
  for (const target of [...targets, ...sealedInternal]) {
    const normalized = target.startsWith("./") ? target.slice(2) : target;
    if (!normalized.endsWith("/mod.ts") || !normalized.startsWith(prefix)) continue;
    dirs.add(dirname(normalized).slice(prefix.length));
  }
  return [...dirs].sort();
}

function resolveSources(root: string, sourceDir: string): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        files.push({ path: relative(root, full).split("\\").join("/"), source: readFileSync(full, "utf-8") });
      }
    }
  };
  const base = resolve(root, sourceDir);
  if (existsSync(base)) walk(base);
  return files;
}

/** Fails once per unordered pair whose two declared directions are both `value`. @public */
export function validateNoMutualValuePairs(edges: DeclaredGraph["edges"]): Finding[] {
  const findings: Finding[] = [];
  for (const a of Object.keys(edges).sort()) {
    const targets = edges[a];
    if (targets === undefined) continue;
    for (const b of Object.keys(targets).sort()) {
      if (a >= b) continue;
      if (targets[b] !== "value" || edges[b]?.[a] !== "value") continue;
      findings.push(
        fail(
          `\`${a}\` → \`${b}\` and \`${b}\` → \`${a}\` are both \`value\` edges — a mutually-naming pair is legal only while one direction is erased at emit; make one direction \`import type\` and declare it \`"type"\`, or move the shared symbol into a namespace both may depend on and delete the edge`,
          { file: `edges ${a} ↔ ${b}` },
        ),
      );
    }
  }
  return findings;
}

/** The failure text each enumeration finding produces, in the order `findEnumerations` reports them. @public */
export function validateNoEnumeration(lines: readonly string[], doc: string): Finding[] {
  const findings: Finding[] = [];
  for (const finding of findEnumerations(lines)) {
    const at = finding.line === null ? { file: doc } : { file: doc, line: finding.line };
    switch (finding.kind) {
      case "missing-classification-section":
        findings.push(fail("no `### 4a.` heading — the classification section moved, and the guard no longer covers it", { file: doc }));
        break;
      case "composes-table":
        findings.push(
          fail(
            "the `| Namespace | Composes |` table is back — the graph module is authoritative and the document enumerates nothing; delete the table and cite the declared edges instead",
            at,
          ),
        );
        break;
      case "missing-catalog-section":
        findings.push(fail("no `### 3a.` heading — the catalog section moved, and the guard no longer covers it", { file: doc }));
        break;
      case "classification-column":
        findings.push(
          fail(
            "the catalog's classification column is back — the graph module is authoritative for leaf/integration and `package.json` `sideEffects` for side-effect status; the document enumerates neither, so delete the column and cite them instead",
            at,
          ),
        );
        break;
    }
  }
  return findings;
}

/** Run all three checks. @public */
export function checkNamespaceGraph(config: NamespaceGraphCheckConfig): CheckResult {
  const sourceDir = config.sourceDir ?? "src";
  const namespaces = resolveNamespaces(config.exports, config.sealedInternal ?? [], sourceDir);
  const observed = buildGraph(resolveSources(config.root, sourceDir), namespaces);

  const findings: Finding[] = diffGraph(observed, config.graph, namespaces).map((finding) => {
    if (finding.file === undefined) return fail(finding.detail, { file: "edges" });
    return fail(finding.detail, finding.line === undefined ? { file: finding.file } : { file: finding.file, line: finding.line });
  });

  findings.push(...validateNoMutualValuePairs(config.graph.edges));

  if (config.enumerationDoc !== undefined) {
    const path = resolve(config.root, config.enumerationDoc);
    if (!existsSync(path)) {
      findings.push(fail("the classification document is missing — this check has nothing to guard", { file: config.enumerationDoc }));
    } else {
      findings.push(...validateNoEnumeration(readFileSync(path, "utf-8").split("\n"), config.enumerationDoc));
    }
  }

  const edgeCount = namespaces.reduce((total, namespace) => total + Object.keys(config.graph.edges[namespace] ?? {}).length, 0);

  return checkResult(findings, `${namespaces.length} namespaces, ${edgeCount} declared edges — every import matches the declaration.`);
}
