import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };
import { EDGES, LEAF, PRIMITIVES } from "./namespace-graph";
import { buildGraph, diffGraph, findEnumerations, type SourceFile } from "./namespace-graph-parse";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_EXPORTS = (pkg as { exports?: Record<string, { import?: string; types?: string } | string> }).exports ?? {};

/** Barrels that are deliberately not published — every symbol is `@internal` and consumed only
 *  within forge. Mirrors `SEALED_INTERNAL` in `validate-exports.ts`: they are namespaces for
 *  layering purposes even though no consumer can name them. */
const SEALED_INTERNAL = ["src/crypto/mod.ts"];

/**
 * The namespace set: the directory of every `mod.ts` the exports map names, plus the sealed-internal
 * barrels, each relative to `src/`.
 *
 * Derived, never listed. **A directory is a namespace only when it owns a subpath** — which is what
 * keeps `src/assets/cli/` out of the set without an exemption, so its `cli` import is correctly
 * `assets`' edge rather than an edge of a namespace the package does not have. A hardcoded list
 * would have to be edited in lockstep with `exports`, and the whole point of this gate is to catch
 * the edits nobody made.
 */
function collectNamespaces(): string[] {
  const dirs = new Set<string>();
  const targets = Object.values(PKG_EXPORTS)
    .map((entry) => (typeof entry === "string" ? entry : (entry.import ?? entry.types)))
    .filter((target): target is string => target !== undefined);

  for (const target of [...targets, ...SEALED_INTERNAL]) {
    const normalized = target.startsWith("./") ? target.slice(2) : target;
    if (!normalized.endsWith("/mod.ts")) continue;
    if (!normalized.startsWith("src/")) continue;
    dirs.add(dirname(normalized).slice("src/".length));
  }
  return [...dirs].sort();
}

/** Every non-test `.ts`/`.tsx` file under `src/`, read, with repo-relative posix paths. Test files
 *  are dropped by `buildGraph` itself — the exclusion belongs with the matchers, where it is
 *  assertable. */
function collectSources(): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        files.push({ path: relative(ROOT, full).split("\\").join("/"), source: readFileSync(full, "utf-8") });
      }
    }
  };
  const srcDir = resolve(ROOT, "src");
  if (existsSync(srcDir)) walk(srcDir);
  return files;
}

// Run state, written only by `fail` and reset by `main`, so importing this module observes a zero
// count and a second call starts from the same place a fresh process would.
let failures = 0;

function fail(subject: string, message: string): void {
  console.error(`FAIL ${subject}: ${message}`);
  failures++;
}

// ── Check 2: the enumeration has not come back ────────────────────────────────────────────────
// `scripts/namespace-graph.ts` is authoritative, so the document must cite it and enumerate
// nothing. This guard asserts an **absence** — the `Namespace | Composes` table is gone — which is
// why it cannot itself drift. There is deliberately no doc-versus-data cross-check: that would
// reintroduce the markdown parser this design rejects, and with it a gate that fails on a reflow.

const CLASSIFICATION_DOC = ".decisions/NAMESPACE_DESIGN.md";

/**
 * The failure line each enumeration finding produces, in the order `findEnumerations` reports them.
 *
 * The four messages stay in this file rather than travelling with the findings, and deliberately
 * unlike `Finding.detail`: those are parameterised by namespace names only `diffGraph` can compute,
 * while these are fixed strings that depend on nothing the scan discovers. Keeping them in the entry
 * point is what makes this the one file that decides what the gate prints.
 *
 * Returned rather than printed so the mapping is assertable: `lines` is the only input, so a test
 * drives all four arms over synthetic markdown without a document, a spawn, or a console capture.
 */
export function enumerationFailures(lines: string[]): { subject: string; message: string }[] {
  const out: { subject: string; message: string }[] = [];
  for (const finding of findEnumerations(lines)) {
    switch (finding.kind) {
      case "missing-classification-section":
        out.push({
          subject: CLASSIFICATION_DOC,
          message: "no `### 4a.` heading — the classification section moved, and the guard below no longer covers it",
        });
        break;
      case "composes-table":
        out.push({
          subject: `${CLASSIFICATION_DOC}:${finding.line}`,
          message:
            "the `| Namespace | Composes |` table is back — `scripts/namespace-graph.ts` is authoritative for the graph and the document enumerates nothing; delete the table and cite `EDGES` instead",
        });
        break;
      case "missing-catalog-section":
        out.push({
          subject: CLASSIFICATION_DOC,
          message: "no `### 3a.` heading — the catalog section moved, and the guard below no longer covers it",
        });
        break;
      // The catalog table names every export path, so a classification column there is the same
      // enumeration in a second place — and `sideEffects` in `package.json` owns the other half of it.
      case "classification-column":
        out.push({
          subject: `${CLASSIFICATION_DOC}:${finding.line}`,
          message:
            "the catalog's classification column is back — `scripts/namespace-graph.ts` is authoritative for leaf/integration and `package.json` `sideEffects` for side-effect status; the document enumerates neither, so delete the column and cite them instead",
        });
        break;
    }
  }
  return out;
}

function checkNoEnumeration(): void {
  const path = resolve(ROOT, CLASSIFICATION_DOC);
  if (!existsSync(path)) {
    fail(CLASSIFICATION_DOC, "the classification document is missing — this gate has nothing to guard");
    return;
  }

  for (const { subject, message } of enumerationFailures(readFileSync(path, "utf-8").split("\n"))) {
    fail(subject, message);
  }
}

// ── Check 3: no mutually-naming pair carries a value edge in both directions ──────────────────
// A pair that names each other is legal exactly while one direction is erased at emit; two value
// directions is a real runtime cycle. Check 1 cannot see it — each half is declared, observed and
// kind-matched on its own — so this is a predicate over the declaration alone, with no file walk.

/** Fails once per unordered pair whose two declared directions are both `value`. The `a < b` guard
 *  is what makes it once and not twice, and fixes which namespace the message names first. */
function checkNoMutualValuePairs(): void {
  for (const a of Object.keys(EDGES).sort()) {
    // `a` came from `EDGES`'s own keys, so the lookup is populated by construction.
    const targets = EDGES[a];
    if (targets === undefined) continue;
    for (const b of Object.keys(targets).sort()) {
      if (a >= b) continue;
      if (targets[b] !== "value" || EDGES[b]?.[a] !== "value") continue;
      fail(
        `EDGES ${a} ↔ ${b}`,
        `\`${a}\` → \`${b}\` and \`${b}\` → \`${a}\` are both \`value\` edges — a mutually-naming pair is legal only while one direction is erased at emit; make one direction \`import type\` and declare it \`"type"\`, or move the shared symbol into a namespace both may depend on and delete the edge`,
      );
    }
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────────────────────
/** Runs all three checks and returns the exit code rather than exiting, so a test can import this
 *  module, call it, and read the verdict without the runner dying. Nothing above this line walks
 *  `src/` or reads the classification document — that starts here.
 *
 *  Check 1 is inline: the observed graph must match the declared one. An undeclared import is how a
 *  leaf quietly becomes an integration namespace and how a cycle gets its first half — neither leaves
 *  any other trace, since both compile, both pass every test, and both read as ordinary code at the
 *  call site. */
export function main(): number {
  failures = 0;

  const namespaces = collectNamespaces();
  const observed = buildGraph(collectSources(), namespaces);
  const findings = diffGraph(observed, { primitives: PRIMITIVES, leaf: LEAF, edges: EDGES }, namespaces);

  const bySource = new Map<string, number>();
  for (const finding of findings) {
    const subject = finding.file === undefined ? "EDGES" : `${finding.file}:${finding.line}`;
    fail(subject, finding.detail);
    bySource.set(finding.from, (bySource.get(finding.from) ?? 0) + 1);
  }

  let edgeCount = 0;
  for (const namespace of namespaces) {
    const declared = Object.keys(EDGES[namespace] ?? {}).length;
    edgeCount += declared;
    if (bySource.has(namespace)) continue;
    const shape = LEAF.includes(namespace) ? "leaf" : `${declared} edge${declared === 1 ? "" : "s"}`;
    console.log(`  ok ${namespace} (${shape})`);
  }

  checkNoEnumeration();
  checkNoMutualValuePairs();

  if (failures > 0) {
    console.error(`\n${failures} problem${failures === 1 ? "" : "s"} found.`);
    return 1;
  }
  console.log(`\nAll namespace edges verified (${namespaces.length} namespaces, ${edgeCount} declared edges).`);
  return 0;
}

if (import.meta.main) process.exit(main());
