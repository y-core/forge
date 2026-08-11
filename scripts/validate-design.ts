import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };
import { parseConsumerExportNames } from "./barrel-parse";
import {
  type Finding,
  findBarrelImports,
  findCustomPropertyCitations,
  findRuleCitations,
  findRuleMarkers,
  findSourceViolations,
  formatFinding,
  isValidRuleId,
  parseDeclaredCustomProperties,
  RULE_CORPUS_PATH,
  type RuleId,
} from "./design-parse";
import { findSubpathCitations } from "./docs-parse";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = (pkg as { name: string }).name;
const PKG_EXPORTS = (pkg as { exports?: Record<string, { import?: string; types?: string } | string> }).exports ?? {};

const DESIGN_DIR = "src/ui/design";
/** The source checks walk **all** of `src/`, not `src/ui/` alone. The corpus states rules about
 *  markup, and forge renders markup outside `ui/` — `logging/show/` is a whole surface. Scoped to
 *  `ui/`, the gate said "forge's own source is checked" while a viewer one directory over carried a
 *  palette that no rule could see. The corpus-side checks stay on `DESIGN_DIR`; only the source walk
 *  widens. Rules that are genuinely `ui/`-local scope themselves in the finder — `findRawControls`
 *  is the worked example — because that scoping is part of what those rules mean. */
const SRC_DIR = "src";
const CSS_DIR = "src/ui/assets/css";

// ── Exports-map resolution ────────────────────────────────────────────────────────────────────
// The same two-form lookup `validate-docs.ts` performs, and for the same reason: an exact key is
// proven real by `validate-exports`, while a subpath *pattern* matches by shape, so a pattern hit
// must additionally be confirmed on disk or the corpus could cite a stylesheet nobody ever wrote.
// `*` matches greedily across `/`, which is why the star's span is taken as the whole middle.

const EXPORT_SUBPATHS = new Set(Object.keys(PKG_EXPORTS).filter((key) => !key.includes("*")));

const EXPORT_PATTERNS = Object.entries(PKG_EXPORTS)
  .filter(([key]) => key.includes("*"))
  .map(([key, value]) => {
    const target = typeof value === "string" ? value : (value.import ?? value.types);
    // Only starred keys reach here, so both halves of each split are present; the defaults never apply.
    const [keyPrefix = "", keySuffix = ""] = key.split("*");
    const [targetPrefix = "", targetSuffix = ""] = (target ?? "").split("*");
    return { keyPrefix, keySuffix, targetPrefix, targetSuffix };
  });

function isExportSubpath(subpath: string): boolean {
  if (EXPORT_SUBPATHS.has(subpath)) return true;
  return EXPORT_PATTERNS.some(({ keyPrefix, keySuffix, targetPrefix, targetSuffix }) => {
    if (!subpath.startsWith(keyPrefix) || !subpath.endsWith(keySuffix)) return false;
    if (subpath.length < keyPrefix.length + keySuffix.length) return false;
    const star = subpath.slice(keyPrefix.length, subpath.length - keySuffix.length);
    return existsSync(resolve(ROOT, `${targetPrefix}${star}${targetSuffix}`));
  });
}

/** The module a subpath resolves to, when that subpath is an exact key naming a `.ts`/`.tsx` file. */
function moduleForSubpath(subpath: string): string | undefined {
  const entry = PKG_EXPORTS[subpath];
  if (entry === undefined) return undefined;
  const target = typeof entry === "string" ? entry : (entry.import ?? entry.types);
  if (!target || !/\.tsx?$/.test(target)) return undefined;
  return resolve(ROOT, target);
}

// ── Run state ─────────────────────────────────────────────────────────────────────────────────
// Shared by the checks below rather than threaded through all of them. `main` is the only writer
// that resets it, so importing this module observes a zero count, and a second call to `main`
// starts from the same place a fresh process would.
let failures = 0;

function fail(file: string, message: string): void {
  console.error(`FAIL ${file}: ${message}`);
  failures++;
}

function failFinding(finding: Finding): void {
  console.error(`FAIL ${formatFinding(finding)}`);
  failures++;
}

// ── Collection ────────────────────────────────────────────────────────────────────────────────

function collectFiles(dir: string, accept: (name: string) => boolean): string[] {
  const root = resolve(ROOT, dir);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && accept(entry.name)) out.push(relative(ROOT, full));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * The `.tsx` files the source checks run over: **non-test files only**.
 *
 * The exclusion is load-bearing rather than tidy. `*.test.tsx` files assert on rendered HTML
 * strings, so every class the component under test emits appears verbatim in its expectation — a
 * check that read them would report each deliberate arbitrary value once per assertion, and the
 * escape hatch could not be written into a string literal without changing what the test asserts.
 * `*.browser.ts*` is excluded for the same reason and because it is not shipped.
 */
function collectSources(): string[] {
  return collectFiles(SRC_DIR, (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx") && !/\.browser\.tsx?$/.test(name));
}

// ── Check 1: every subpath the corpus cites resolves through the exports map ──────────────────
// Strict matching, as for the governing docs: a corpus is teaching material, so a subpath named in
// a prose sentence sends a reader to a resolution error just as surely as one named in an import.
// `findSubpathCitations` already skips the three shapes that write *about* a subpath without naming
// one (bare package name, trailing `/`, an elided `...`), which is the only exemption prose needs.

function checkSubpaths(file: string, source: string): void {
  for (const { line, raw, subpath } of findSubpathCitations(source, PACKAGE_NAME, { strict: true })) {
    if (!isExportSubpath(subpath)) {
      fail(file, `line ${line}: \`${PACKAGE_NAME}${raw}\` is not reachable through package.json exports`);
    }
  }
}

// ── Check 2: every symbol the corpus imports is exported by that barrel ───────────────────────

function checkBarrelSymbols(file: string, source: string): void {
  for (const { line, subpath, symbols } of findBarrelImports(source, PACKAGE_NAME)) {
    const modulePath = moduleForSubpath(subpath);
    // An unresolvable subpath is check 1's finding; reporting it twice would only add noise.
    if (modulePath === undefined || !existsSync(modulePath)) continue;

    // `parseConsumerExportNames`, not `parseBarrelExportNames`: the question here is what a reader
    // copying this sample may write, and an `as` alias means the old name is no longer one of them.
    // The both-sides variant would pass a barrel export that was renamed rather than removed, which
    // is the drift shape this check is most likely to meet.
    const exported = parseConsumerExportNames(modulePath);
    const missing = symbols.filter((symbol) => !exported.has(symbol));
    if (missing.length > 0) {
      fail(file, `line ${line}: \`${PACKAGE_NAME}${subpath.slice(1)}\` does not export ${missing.map((n) => `\`${n}\``).join(", ")}`);
    }
  }
}

// ── Check 3: every CSS custom property the corpus names is declared ───────────────────────────

function declaredCustomProperties(): Set<string> {
  const names = new Set<string>();
  for (const file of collectFiles(CSS_DIR, (name) => name.endsWith(".css"))) {
    for (const name of parseDeclaredCustomProperties(readFileSync(resolve(ROOT, file), "utf-8"))) names.add(name);
  }
  return names;
}

function checkCustomProperties(file: string, source: string, declared: ReadonlySet<string>): void {
  for (const { line, property, family } of findCustomPropertyCitations(source)) {
    if (family) {
      // A family holds when at least one declared property extends it. Weaker than an exact match by
      // construction — that is what a family citation means — but not vacuous: the prefix still has
      // to name something the stylesheets actually declare, so `--nonexistent-*` fails here.
      if ([...declared].some((name) => name.startsWith(`${property}-`))) continue;
      fail(file, `line ${line}: \`${property}-*\` matches no property declared in ${CSS_DIR}/`);
      continue;
    }
    if (declared.has(property)) continue;
    fail(file, `line ${line}: \`${property}\` is declared by no stylesheet in ${CSS_DIR}/`);
  }
}

// ── Check 4: rule ids are well formed, unique, and defined where they are cited ───────────────

interface RuleIndex {
  /** Every well-formed id the corpus defines. */
  defined: Set<string>;
  /** Files this pass already faulted, so the per-file loop does not go on to print `ok` for them.
   *  Uniqueness is a corpus-wide property and so cannot be decided inside that loop. */
  faulted: Set<string>;
}

function indexRuleMarkers(sources: ReadonlyMap<string, string>): RuleIndex {
  const defined = new Set<string>();
  const faulted = new Set<string>();
  /** `file:line` of each id's first definition, for the duplicate message. */
  const origin = new Map<string, string>();

  for (const [file, source] of sources) {
    for (const { line, id } of findRuleMarkers(source)) {
      const at = `${file}:${line}`;
      if (!isValidRuleId(id)) {
        fail(file, `line ${line}: rule id \`${id}\` is malformed — ids are \`forge-ui-\` prefixed, kebab-case, and carry no trailing punctuation`);
        faulted.add(file);
        continue;
      }
      const first = origin.get(id);
      if (first !== undefined) {
        fail(file, `line ${line}: duplicate rule id \`${id}\` — already defined at ${first}`);
        faulted.add(file);
        continue;
      }
      origin.set(id, at);
      defined.add(id);
    }
  }
  return { defined, faulted };
}

function checkRuleCitations(file: string, source: string, defined: ReadonlySet<string>): void {
  for (const { line, id } of findRuleCitations(source)) {
    if (defined.has(id)) continue;
    fail(file, `line ${line}: cites rule \`${id}\`, which no corpus file defines`);
  }
}

/**
 * The validator's own rule table, held to the same standard as the corpus: every id it prints must
 * be a rule the corpus states, and every corpus path it routes a reader to must be a file that is
 * there. Without the second half the table decays into a set of plausible-looking dead links, which
 * is the failure this whole script exists to prevent one directory over.
 */
function checkRuleTable(defined: ReadonlySet<string>, corpusFiles: ReadonlySet<string>): void {
  const table = "scripts/design-parse.ts";
  for (const [ruleId, corpusPath] of Object.entries(RULE_CORPUS_PATH) as [RuleId, string][]) {
    if (!defined.has(ruleId)) {
      fail(table, `RULE_CORPUS_PATH names \`${ruleId}\`, which no corpus file defines with a \`<!-- rule:${ruleId} -->\` marker`);
    }
    if (!corpusFiles.has(corpusPath)) {
      fail(table, `RULE_CORPUS_PATH routes \`${ruleId}\` to \`${corpusPath}\`, which is not a corpus file`);
    }
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────────────────────
/** Runs every check and returns the exit code rather than exiting, so a test can import this module,
 *  call it, and read the verdict without the runner dying. Nothing above this line reads a document —
 *  the walks start here. */
export function main(): number {
  failures = 0;

  const corpusFiles = collectFiles(DESIGN_DIR, (name) => name.endsWith(".md"));
  // An empty corpus fails rather than passing vacuously — the same posture `selectSteps` takes when
  // a gate selects no steps. A green that ran nothing is indistinguishable from a green that ran
  // everything, and here it would also mean the `./ui/design/*.md` export resolves to nothing.
  if (corpusFiles.length === 0) {
    fail(DESIGN_DIR, "no markdown found — the design corpus is published through package.json exports and cannot be empty");
    console.error("\n1 problem found.");
    return 1;
  }

  const sources = new Map<string, string>();
  for (const file of corpusFiles) sources.set(file, readFileSync(resolve(ROOT, file), "utf-8"));

  const { defined, faulted } = indexRuleMarkers(sources);
  const declared = declaredCustomProperties();

  for (const [file, source] of sources) {
    const before = failures;
    checkSubpaths(file, source);
    checkBarrelSymbols(file, source);
    checkCustomProperties(file, source, declared);
    checkRuleCitations(file, source, defined);
    if (failures === before && !faulted.has(file)) console.log(`  ok ${file}`);
  }

  checkRuleTable(defined, new Set(corpusFiles));

  const srcSources = collectSources();
  for (const file of srcSources) {
    const source = readFileSync(resolve(ROOT, file), "utf-8");
    const findings = findSourceViolations(source, file);
    for (const finding of findings) failFinding(finding);
  }

  if (failures > 0) {
    console.error(`\n${failures} problem${failures === 1 ? "" : "s"} found.`);
    return 1;
  }
  console.log(`\nDesign corpus verified (${corpusFiles.length} corpus files, ${srcSources.length} sources).`);
  return 0;
}

if (import.meta.main) process.exit(main());
