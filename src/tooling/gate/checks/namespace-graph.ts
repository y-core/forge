import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import { buildGraph, diffGraph, findEnumerations } from "./namespace-graph-parse";
import { readPackageImports } from "./package-imports";
import { collectFiles, isTestSource } from "./source-scan";
import type { ExportsMap } from "./types";
import type { DeclaredGraph, SourceFile } from "./types";
import type { NamespaceGraphCheckConfig } from "./types";

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
  return collectFiles(root, sourceDir, (name) => /\.tsx?$/.test(name))
    .filter((path) => !isTestSource(path))
    .map((path) => ({ path, source: readFileSync(resolve(root, path), "utf-8") }));
}

function valueTargets(edges: DeclaredGraph["edges"], from: string): string[] {
  return Object.entries(edges[from] ?? {})
    .filter(([, kind]) => kind === "value")
    .map(([to]) => to)
    .sort();
}

function reachersAbove(edges: DeclaredGraph["edges"], start: string): Set<string> {
  const reachers = new Set<string>();
  const candidates = Object.keys(edges).filter((name) => name > start);
  let grew = true;
  while (grew) {
    const added = candidates.filter((name) => !reachers.has(name) && valueTargets(edges, name).some((to) => to === start || reachers.has(to)));
    for (const name of added) reachers.add(name);
    grew = added.length > 0;
  }
  return reachers;
}

function cyclesFrom(edges: DeclaredGraph["edges"], start: string): string[][] {
  const reachers = reachersAbove(edges, start);
  const cycles: string[][] = [];
  const walk = (from: string, path: readonly string[]): void => {
    for (const to of valueTargets(edges, from)) {
      if (to === start) cycles.push([...path, start]);
      else if (reachers.has(to) && !path.includes(to)) walk(to, [...path, to]);
    }
  };
  walk(start, [start]);
  return cycles;
}

/** Fails once per cycle of declared `value` edges, of any length, naming it from its alphabetically first namespace. @public */
export function validateNoValueCycles(edges: DeclaredGraph["edges"]): Finding[] {
  return Object.keys(edges)
    .sort()
    .flatMap((start) => cyclesFrom(edges, start))
    .map((cycle) =>
      fail(
        `${cycle.map((name) => `\`${name}\``).join(" → ")} is a cycle of \`value\` edges — a cycle of namespaces naming each other is legal only while one edge in it is erased at emit; make one direction \`import type\` and declare it \`"type"\`, or move the shared symbol into a namespace both may depend on and delete the edge`,
        { file: `edges ${cycle.join(" → ")}` },
      ),
    );
}

/** The failure text each enumeration finding produces, in the order `findEnumerations` reports them. @public */
export function validateNoEnumeration(lines: readonly string[], doc: string, namespaces: readonly string[], sourceDir = "src"): Finding[] {
  const findings: Finding[] = [];
  for (const finding of findEnumerations(lines, namespaces, sourceDir)) {
    const at = { file: doc, line: finding.line };
    switch (finding.kind) {
      case "composes-table":
        findings.push(
          fail(
            "the `| Namespace | Composes |` table is back — the graph module is authoritative and the document enumerates nothing; delete the table and cite the declared edges instead",
            at,
          ),
        );
        break;
      case "classification-column":
        findings.push(
          fail(
            "the catalog's classification column is back — the graph module is authoritative for leaf/integration and `package.json` `sideEffects` for side-effect status; the document enumerates neither, so delete the column and cite them instead",
            at,
          ),
        );
        break;
      case "catalog-table":
        findings.push(
          fail(
            "a namespace catalogue is back — this table names a namespace's source or subpath, and what a namespace does lives in its own README, its exports in its `mod.ts` and its edges in the declared graph; delete the table rather than keep it in step",
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
  if (namespaces.length === 0) return scannedNothing(`\`${sourceDir}\` resolved no namespace from the export map`, "namespace-graph");

  const sources = resolveSources(config.root, sourceDir);
  if (sources.length === 0) return scannedNothing(`\`${sourceDir}\` matched no source`, "namespace-graph");
  const observed = buildGraph(sources, namespaces, readPackageImports(config.root));

  const findings: Finding[] = diffGraph(observed, config.graph, namespaces).map((finding) => {
    if (finding.file === undefined) return fail(finding.detail, { file: "edges" });
    return fail(finding.detail, finding.line === undefined ? { file: finding.file } : { file: finding.file, line: finding.line });
  });

  findings.push(...validateNoValueCycles(config.graph.edges));

  if (config.enumerationDoc !== undefined) {
    const path = resolve(config.root, config.enumerationDoc);
    if (!existsSync(path)) {
      findings.push(fail("the classification document is missing — this check has nothing to guard", { file: config.enumerationDoc }));
    } else {
      findings.push(...validateNoEnumeration(readFileSync(path, "utf-8").split("\n"), config.enumerationDoc, namespaces, sourceDir));
    }
  }

  const edgeCount = namespaces.reduce((total, namespace) => total + Object.keys(config.graph.edges[namespace] ?? {}).length, 0);

  return checkResult(findings, `${namespaces.length} namespaces, ${edgeCount} declared edges — every import matches the declaration.`);
}
