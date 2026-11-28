import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { stripJsonc } from "../../../src/tooling/cli/jsonc";
import { isValidRuleId } from "../../../src/tooling/gate/checks/design-parse";
import {
  balancedSpan,
  blankSourceLiterals,
  collectFiles,
  isTestSource,
  lineAt,
  stringLiterals,
} from "../../../src/tooling/gate/checks/source-scan";
import { checkResult, fail, scannedNothing } from "../../../src/tooling/gate/finding";
import type { CheckResult, Finding } from "../../../src/tooling/gate/types";
import { CANON_ROOT } from "../paths";
import { compileDetector, detectorReaches, searchableFiles } from "../rules/check";
import { registerTrees, ruleDocuments } from "../rules/load";
import { collectMarkers } from "../rules/markers";
import { buildRegister } from "../rules/resolve";
import type {
  RegisteredRule,
  RegisterProblem,
  RgDetector,
  RgExample,
  RuleDetector,
  RuleEntry,
  RuleMarkerSite,
  RuleSource,
  SplitRuleMarker,
} from "../rules/types";
import type { Kind, Tree } from "../types";

/** A lint plugin as the rules check reads it. @public */
export interface RulesPlugin {
  /** Repository-relative; where a finding about one of its rules points. */
  readonly file: string;
  /** What an oxlint config spells before a rule's key, such as `forge/`. */
  readonly prefix: string;
  readonly rules: Readonly<Record<string, object>>;
}

/** What the rules check needs to know about the project. @public */
export interface RulesCheckConfig {
  /** Repository root; every reported path is relative to it. */
  root: string;
  kind: Kind;
  sources: readonly RuleSource[];
  /** What every repository entry's id starts with, followed by `-`. */
  repoSlug: string;
  /** Canon trees whose documents are scanned for markers. Defaults to `registerTrees(root, kind, canonRoot)`. */
  trees?: readonly Tree[];
  /** Where the canon documents are read from. Defaults to `CANON_ROOT`. */
  canonRoot?: string;
  /** Relative to `root`; a lint key is enabled when any of them turns it on. */
  oxlintConfigs: readonly string[];
  plugin?: RulesPlugin;
  /** Every label the gate declares, which a `step` detector must name. */
  stepLabels: readonly string[];
  /** Directories, relative to `root`, whose non-test sources must name a rule by id and never by section. */
  findingSources?: readonly string[];
  /** Ids a check reports under outside the plugin, each of which must be registered. */
  reportedIds?: readonly string[];
  /** A source tree every in-scope rg rule must reach, as `warden check` would search it, unless `exempt` says why it binds nothing there. */
  sourceReach?: { readonly dir: string; readonly exempt: Readonly<Record<string, string>> };
}

/** The rules an oxlint config turns on, or `undefined` when the file could not be read. @internal */
export function readEnabledRules(path: string): Set<string> | undefined {
  type Block = { rules?: Record<string, unknown> };
  let parsed: Block & { overrides?: readonly Block[] };
  try {
    parsed = JSON.parse(stripJsonc(readFileSync(path, "utf-8"))) as Block & { overrides?: readonly Block[] };
  } catch {
    return undefined;
  }
  const entries = [parsed, ...(parsed.overrides ?? [])].flatMap((block) => Object.entries(block.rules ?? {}));
  return new Set(entries.filter(([, level]) => (Array.isArray(level) ? level[0] : level) !== "off").map(([rule]) => rule));
}

const SECTION_CITATION = /§\d/;

const SENTENCE_BREAK = /[.!?]\s+[A-Z]/;

const OVERRIDE_CONDITION = /\bunless\b/;

const RESTATED_RUN = 6;

const FINDING_CALL = /(?<![\w$.])(?:fail|warn)\s*\(/g;

const RULE_PROPERTY = /\brule\s*:\s*(["'`])/g;

function problemFinding(problem: RegisterProblem): Finding {
  const { id, file } = problem;
  const at = { file, ...(problem.line === undefined ? {} : { line: problem.line }) };
  switch (problem.kind) {
    case "no-marker":
      return fail(`rule \`${id}\` has no marker — open the paragraph that argues it with \`<!-- rule:${id} -->\``, at);
    case "no-entry":
      return fail(`rule marker \`${id}\` has no register entry — declare it in a rule file`, at);
    case "duplicate-entry":
      return fail(`rule \`${id}\` is declared twice — first in ${problem.other ?? "another rule file"}`, at);
    case "duplicate-marker":
      return fail(`duplicate rule marker \`${id}\` — already at ${problem.other ?? "another marker"}`, at);
    case "origin-mismatch":
      return fail(
        `rule marker \`${id}\` sits outside what ${problem.other ?? "its rule file"} governs — a canon file's rules are marked in the document it mirrors, a repository's in its own`,
        at,
      );
    case "no-section":
      return fail(`rule marker \`${id}\` sits under no numbered section, so the rule has no rationale to cite`, at);
  }
}

function idPrefix(source: RuleSource, repoSlug: string, canonRoot: string): string {
  if (source.origin === "repo" || source.doc === undefined) return `${repoSlug}-`;
  const slug = basename(source.doc, ".md").toLowerCase().replaceAll("_", "-");
  const otherTree = source.tree === "libs" ? "apps" : source.tree === "apps" ? "libs" : undefined;
  return otherTree !== undefined && existsSync(join(canonRoot, otherTree, source.doc)) ? `${source.tree}-${slug}-` : `${slug}-`;
}

function statementFault(statement: string): string | undefined {
  if (statement.trim() === "") return "is empty";
  if (statement.includes("\n")) return "spans more than one line";
  if (!statement.endsWith(".")) return "does not end in `.`";
  const forbidden = ["*", "|", "<!--"].find((token) => statement.includes(token));
  if (forbidden !== undefined) return `contains \`${forbidden}\``;
  if (SENTENCE_BREAK.test(statement.replace(/`[^`]*`/g, "``"))) return "is more than one sentence";
  return undefined;
}

function detectorName(detector: RuleDetector): string {
  switch (detector.kind) {
    case "lint":
      return `lint \`${detector.key}\``;
    case "step":
      return `step \`${detector.label}\``;
    case "test":
      return `test \`${detector.path}\``;
    case "rg":
      return `rg \`${detector.pattern}\``;
    default:
      return detector.kind;
  }
}

function secondArgument(blanked: string, open: number, close: number): [number, number] | undefined {
  let depth = 0;
  let start: number | undefined;
  for (let i = open + 1; i < close; i++) {
    const char = blanked[i];
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") depth--;
    else if (char === "," && depth === 0) {
      if (start !== undefined) return [start, i];
      start = i + 1;
    }
  }
  return start === undefined ? undefined : [start, close];
}

function literalRuleIdsOfFindingCalls(source: string): { id: string; line: number }[] {
  const blanked = blankSourceLiterals(source);
  const found: { id: string; line: number }[] = [];
  for (const call of blanked.matchAll(FINDING_CALL)) {
    const open = call.index + call[0].length - 1;
    const close = balancedSpan(blanked, open);
    const span = close === -1 ? undefined : secondArgument(blanked, open, close);
    if (span === undefined) continue;
    for (const property of blanked.slice(span[0], span[1]).matchAll(RULE_PROPERTY)) {
      const start = span[0] + property.index + property[0].length;
      const end = blanked.indexOf(property[1] ?? "", start);
      const id = end === -1 ? "" : source.slice(start, end);
      if (end !== -1 && !id.includes("${")) found.push({ id, line: lineAt(source, start) });
    }
  }
  return found;
}

function entryFindings(entry: RuleEntry, source: RuleSource, config: RulesCheckConfig, enabled: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  const at = { file: source.file };
  const { id } = entry;

  const prefix = idPrefix(source, config.repoSlug, config.canonRoot ?? CANON_ROOT);
  if (!id.startsWith(prefix)) findings.push(fail(`rule \`${id}\` does not start with \`${prefix}\`, the prefix where it is declared`, at));

  const fault = statementFault(entry.statement);
  if (fault !== undefined)
    findings.push(fail(`rule \`${id}\`'s statement ${fault} — a statement is one sentence on one line, ending in \`.\``, at));
  if (entry.statement.startsWith("Default:") && !OVERRIDE_CONDITION.test(entry.statement))
    findings.push(
      fail(
        `rule \`${id}\`'s statement opens \`Default:\` with no override condition — end it with an \`unless …\` clause, or drop \`Default:\` and refile it as Floor`,
        at,
      ),
    );

  const seen = new Set<string>();
  for (const detector of entry.detectors) {
    const name = detectorName(detector);
    if (seen.has(name)) findings.push(fail(`rule \`${id}\` lists the detector ${name} twice`, at));
    seen.add(name);

    if (detector.kind === "lint") {
      if (!enabled.has(detector.key)) findings.push(fail(`rule \`${id}\` names lint key \`${detector.key}\`, which no oxlint config enables`, at));
      const plugin = config.plugin;
      if (plugin !== undefined && detector.key.startsWith(plugin.prefix) && !(detector.key.slice(plugin.prefix.length) in plugin.rules)) {
        findings.push(fail(`rule \`${id}\` names lint key \`${detector.key}\`, which the plugin does not register`, at));
      }
    } else if (detector.kind === "step") {
      if (!config.stepLabels.includes(detector.label))
        findings.push(fail(`rule \`${id}\` names step \`${detector.label}\`, which the gate does not declare`, at));
    } else if (detector.kind === "test") {
      if (!isTestSource(detector.path)) findings.push(fail(`rule \`${id}\` names test \`${detector.path}\`, which is not a test source`, at));
      else if (!existsSync(resolve(config.root, detector.path)))
        findings.push(fail(`rule \`${id}\` names test \`${detector.path}\`, which does not exist`, at));
    } else if (detector.kind === "rg") {
      const compiled = compileDetector(detector);
      if (!compiled.ok) findings.push(fail(`rule \`${id}\`'s rg pattern ${compiled.error}`, at));
      else findings.push(...exampleFindings(id, detector, compiled.data, at));
      if (detector.paths.length === 0) findings.push(fail(`rule \`${id}\`'s rg detector searches no path — name at least \`.\``, at));
      const triaged = detector.triage !== undefined && detector.triage.trim() !== "";
      if (detector.level === "warn" && !triaged)
        findings.push(fail(`rule \`${id}\`'s warn-level rg detector carries no triage — state the false-positive class a hit is read against`, at));
      if (detector.level === "fail" && detector.triage !== undefined)
        findings.push(
          fail(`rule \`${id}\`'s fail-level rg detector carries a triage — a hit that needs triage is a warn, and a fail has none to read`, at),
        );
    }
  }
  return findings;
}

/** A finding for each example the detector reports against its kind: a hit it passes, or a pass it reports. */
function exampleFindings(id: string, detector: RgDetector, pattern: RegExp, at: { file: string }): Finding[] {
  const reports = ([file, line]: RgExample): boolean => detectorReaches(detector, file) && pattern.test(line);
  const { hits = [], passes = [] } = detector.examples ?? {};
  return [
    ...hits
      .filter((example) => !reports(example))
      .map(([file, line]) => fail(`rule \`${id}\`'s rg detector does not report its hit example \`${line}\` at \`${file}\``, at)),
    ...passes.filter(reports).map(([file, line]) => fail(`rule \`${id}\`'s rg detector reports its pass example \`${line}\` at \`${file}\``, at)),
  ];
}

type Declared = ReadonlyMap<string, { entry: RuleEntry; source: RuleSource }>;

function markerFindings(
  sites: readonly RuleMarkerSite[],
  split: readonly SplitRuleMarker[],
): { findings: Finding[]; wellFormed: RuleMarkerSite[] } {
  const findings: Finding[] = [];
  for (const { id, file, line } of split) {
    findings.push(
      fail(`rule marker \`${id}\` is split across lines — keep \`<!-- rule:… -->\` on one line, or its id is never read`, { file, line }),
    );
  }
  const wellFormed: RuleMarkerSite[] = [];
  for (const site of sites) {
    const at = { file: site.file, line: site.line };
    if (!isValidRuleId(site.id)) {
      findings.push(fail(`rule id \`${site.id}\` is malformed — ids are lower-case kebab-case of two or more segments`, at));
      continue;
    }
    wellFormed.push(site);
    if (!site.opensBlock) {
      findings.push(
        fail(
          `rule marker \`${site.id}\` does not open its paragraph, list item or table cell — the prose restates a rule the register holds, so delete the sentence before the marker`,
          at,
        ),
      );
    }
  }
  return { findings, wellFormed };
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word !== "");
}

function longestSharedRun(block: readonly string[], statement: readonly string[]): readonly string[] {
  let best: readonly string[] = [];
  let previous = Array.from({ length: statement.length + 1 }, () => 0);
  for (let i = 1; i <= block.length; i++) {
    const current = Array.from({ length: statement.length + 1 }, () => 0);
    for (let j = 1; j <= statement.length; j++) {
      if (block[i - 1] !== statement[j - 1]) continue;
      const run = (previous[j - 1] ?? 0) + 1;
      current[j] = run;
      if (run > best.length) best = block.slice(i - run, i);
    }
    previous = current;
  }
  return best;
}

function restatementFindings(sites: readonly RuleMarkerSite[], declared: Declared): Finding[] {
  const findings: Finding[] = [];
  for (const site of sites) {
    const statement = declared.get(site.id)?.entry.statement;
    if (statement === undefined) continue;
    const run = longestSharedRun(words(site.block), words(statement));
    if (run.length >= RESTATED_RUN)
      findings.push(
        fail(
          `rule marker \`${site.id}\` opens prose that restates its statement — "${run.join(" ")}"; the register holds that sentence, so delete it`,
          { file: site.file, line: site.line },
        ),
      );
  }
  return findings;
}

function pluginFindings(plugin: RulesPlugin, declared: Declared): Finding[] {
  const findings: Finding[] = [];
  const at = { file: plugin.file };
  for (const [name, rule] of Object.entries(plugin.rules)) {
    const id: unknown = (rule as { id?: unknown }).id;
    const key = `${plugin.prefix}${name}`;
    if (typeof id !== "string") {
      const detecting = [...declared.values()].find(({ entry }) =>
        entry.detectors.some((detector) => detector.kind === "lint" && detector.key === key),
      );
      const hint = detecting === undefined ? "" : ` — \`${detecting.entry.id}\` names it as a lint detector`;
      findings.push(fail(`plugin rule \`${name}\` reports with no rule id${hint}`, at));
      continue;
    }
    const owner = declared.get(id);
    if (owner === undefined) findings.push(fail(`plugin rule \`${name}\` reports under \`${id}\`, which no rule file declares`, at));
    else if (!owner.entry.detectors.some((detector) => detector.kind === "lint" && detector.key === key)) {
      findings.push(fail(`rule \`${id}\` has no lint detector naming \`${key}\`, the plugin rule reporting under it`, { file: owner.source.file }));
    }
  }
  return findings;
}

function findingSourceFindings(root: string, dirs: readonly string[], declared: Declared): Finding[] {
  const findings: Finding[] = [];
  const files = dirs.flatMap((dir) => collectFiles(root, dir, (name) => /\.tsx?$/.test(name) && !isTestSource(name)));
  for (const file of files) {
    const source = readFileSync(resolve(root, file), "utf-8");
    for (const { line, text } of stringLiterals(source)) {
      if (SECTION_CITATION.test(text)) findings.push(fail("names its rule by section, not by id", { file, line }));
    }
    for (const { id, line } of literalRuleIdsOfFindingCalls(source)) {
      if (!declared.has(id)) findings.push(fail(`reports under rule \`${id}\`, which no rule file declares`, { file, line }));
    }
  }
  return findings;
}

function sourceReachFindings(
  root: string,
  kind: Kind,
  rules: readonly RegisteredRule[],
  reach: NonNullable<RulesCheckConfig["sourceReach"]>,
): Finding[] {
  const dir = reach.dir.endsWith("/") ? reach.dir : `${reach.dir}/`;
  const files = searchableFiles(root).filter((file) => file.startsWith(dir));
  const patterned = rules.filter((rule) => rule.scope.includes(kind) && rule.detectors.some((detector) => detector.kind === "rg"));
  const reaches = (rule: RegisteredRule): boolean =>
    rule.detectors.some((detector) => detector.kind === "rg" && files.some((file) => detectorReaches(detector, file)));
  const findings: Finding[] = [];
  const missing = new Set<string>();
  for (const rule of patterned) {
    if (reaches(rule)) continue;
    missing.add(rule.id);
    if (reach.exempt[rule.id] === undefined)
      findings.push(
        fail(
          `rule \`${rule.id}\`'s rg detectors reach no file under \`${dir}\` — widen its paths, or exempt it with the reason it binds nothing there`,
          { file: rule.declaredIn },
        ),
      );
  }
  for (const [id, reason] of Object.entries(reach.exempt)) {
    if (!missing.has(id))
      findings.push(fail(`rule \`${id}\` is exempt from reaching \`${dir}\` but is not an in-scope rg rule that misses it — delete the entry`));
    else if (reason.trim() === "")
      findings.push(fail(`rule \`${id}\` is exempt from reaching \`${dir}\` with no reason — say why it binds nothing there`));
  }
  return findings;
}

function enabledLintKeys(root: string, configs: readonly string[]): { enabled: Set<string>; findings: Finding[] } {
  const enabled = new Set<string>();
  const findings: Finding[] = [];
  for (const file of configs) {
    const rules = readEnabledRules(resolve(root, file));
    if (rules === undefined) findings.push(fail("could not be read as an oxlint config", { file }));
    for (const rule of rules ?? []) enabled.add(rule);
  }
  return { enabled, findings };
}

/** Holds the rule register and the prose to each other: markers to entries, statements to their form and out of the prose, detectors and finding ids to something real. @public */
export function checkRules(config: RulesCheckConfig): CheckResult {
  const { root, kind } = config;
  const canonRoot = config.canonRoot ?? CANON_ROOT;
  const docs = ruleDocuments(root, kind, config.trees ?? registerTrees(root, kind, canonRoot), canonRoot);
  if (docs.length === 0) return scannedNothing("no canon or repository document was found to hold a rule marker", "rules");

  const { sites, split } = collectMarkers(root, docs);
  const markers = markerFindings(sites, split);
  const register = buildRegister(config.sources, markers.wellFormed, kind);
  const lint = enabledLintKeys(root, config.oxlintConfigs);
  const findings = [...markers.findings, ...register.problems.map(problemFinding), ...lint.findings];

  const declared = new Map<string, { entry: RuleEntry; source: RuleSource }>();
  for (const source of config.sources) {
    for (const entry of source.entries) {
      if (!declared.has(entry.id)) declared.set(entry.id, { entry, source });
      findings.push(...entryFindings(entry, source, config, lint.enabled));
    }
  }
  findings.push(...restatementFindings(markers.wellFormed, declared));
  if (config.plugin !== undefined) findings.push(...pluginFindings(config.plugin, declared));
  findings.push(...findingSourceFindings(root, config.findingSources ?? [], declared));
  for (const id of config.reportedIds ?? []) {
    if (!declared.has(id)) findings.push(fail(`\`${id}\` is reported under, but no rule file declares it`));
  }

  if (config.sourceReach !== undefined) findings.push(...sourceReachFindings(root, kind, register.rules, config.sourceReach));

  const pluginRules = Object.keys(config.plugin?.rules ?? {}).length;
  return checkResult(findings, `${register.rules.length} rules, ${sites.length} markers in ${docs.length} documents, ${pluginRules} plugin rules`);
}
