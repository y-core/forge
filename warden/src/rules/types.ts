import type { Kind, Tree } from "../types";

/** A line pattern `warden check` matches as `rg -n` would, over `paths` narrowed by rg-style globs. @public */
export interface RgDetector {
  readonly kind: "rg";
  /** A regular expression, matched per line; a lookaround needs `pcre`. */
  readonly pattern: string;
  /** Repository-relative files or directories searched, as `rg` takes them. */
  readonly paths: readonly string[];
  /** rg `--glob` filters a file must match one of; a glob without `/` matches the basename. */
  readonly include?: readonly string[];
  /** rg `--glob '!…'` filters; a file matching any is skipped. */
  readonly exclude?: readonly string[];
  /** `rg -P`: the pattern uses lookaround. */
  readonly pcre?: boolean;
  /** `rg -i`. */
  readonly ignoreCase?: boolean;
  /** `fail` holds in the gate; `warn` is a hit to read against its triage. */
  readonly level: "fail" | "warn";
  /** The known false-positive class a `warn` hit is read against; a `fail` detector has none. */
  readonly triage?: string;
  /** Lines at repository-relative paths the pattern must report (`hits`) and must pass (`passes`), which `validate-rules` sweeps. */
  readonly examples?: { readonly hits: readonly RgExample[]; readonly passes: readonly RgExample[] };
}

/** One line at the path that decides whether an rg detector reaches it: `[file, line]`. @public */
export type RgExample = readonly [file: string, line: string];

/** What enforces a rule: a lint key as an oxlint config spells it, a gate step label, a test path, a line pattern, the runtime, or review. @public */
export type RuleDetector =
  | { readonly kind: "lint"; readonly key: string }
  | RgDetector
  | { readonly kind: "step"; readonly label: string }
  | { readonly kind: "test"; readonly path: string }
  | { readonly kind: "runtime" }
  | { readonly kind: "review" };

/** The kinds a detector comes in. @public */
export type DetectorKind = RuleDetector["kind"];

/** One register entry, as a rule file declares it. @public */
export interface RuleEntry {
  readonly id: string;
  /** One sentence, and the only copy of it; the prose keeps the marker and the rationale. */
  readonly statement: string;
  readonly detectors: readonly [RuleDetector, ...RuleDetector[]];
}

/** Whether a rule is the fleet's or the repository's own. @public */
export type RuleOrigin = "canon" | "repo";

/** One loaded rule file and the entries its default export declares. @public */
export interface RuleSource {
  readonly origin: RuleOrigin;
  /** Repository-relative; what a finding about the file names, and a rule's `declaredIn`. */
  readonly file: string;
  /** The canon tree a canon file mirrors; absent on the repository's own. */
  readonly tree?: Tree;
  /** The canon document a canon file mirrors, canon-relative within `tree`. */
  readonly doc?: string;
  readonly entries: readonly RuleEntry[];
}

/** One `<!-- rule:<id> -->` marker and where it sits. @public */
export interface RuleMarkerSite {
  readonly id: string;
  readonly corpus: "canon" | "project";
  readonly tree?: Tree;
  /** As a chunk id spells it: canon-relative for `canon`, repository-relative for `project`. */
  readonly path: string;
  /** Repository-relative, for a finding. */
  readonly file: string;
  readonly line: number;
  /** The numbered section holding the marker, such as `5a`; undefined above the first. */
  readonly section: string | undefined;
  /** Whether only whitespace precedes the marker in its paragraph, list item or table cell. */
  readonly opensBlock: boolean;
  /** From the marker to the end of its paragraph, list item or table cell, with code-span backticks dropped. */
  readonly block: string;
}

/** A marker spanning a line break or never closing, so its id reaches no site. @public */
export interface SplitRuleMarker {
  readonly id: string;
  readonly file: string;
  readonly line: number;
}

/** Every marker a set of documents holds outside code. @public */
export interface RuleMarkerScan {
  readonly sites: readonly RuleMarkerSite[];
  readonly split: readonly SplitRuleMarker[];
}

/** The section arguing a rule, and the `knowledge_read` id that serves it. @public */
export interface RuleRationale {
  readonly corpus: "canon" | "project";
  readonly tree?: Tree;
  readonly path: string;
  readonly section: string;
  readonly line: number;
  readonly chunk: string;
}

/** A register entry joined to its marker, with what the marker's position derives. @public */
export interface RegisteredRule {
  readonly id: string;
  readonly statement: string;
  readonly detectors: RuleEntry["detectors"];
  readonly origin: RuleOrigin;
  readonly scope: readonly Kind[];
  readonly rationale: RuleRationale;
  readonly declaredIn: string;
}

/** One way the register and the prose fail to join. @public */
export interface RegisterProblem {
  readonly kind: "no-marker" | "no-entry" | "duplicate-entry" | "duplicate-marker" | "origin-mismatch" | "no-section";
  readonly id: string;
  /** Repository-relative: the rule file for an entry's problem, the document for a marker's. */
  readonly file: string;
  readonly line?: number;
  /** The other side: where a duplicate was first defined, or the rule file a mismatched marker's entry is declared in. */
  readonly other?: string;
}

/** How a rule is held: by a lint key, step or failing pattern, by a test, by a pattern a reviewer triages, at runtime, or by review alone. @public */
export type DetectorClass = "automated" | "test" | "triaged" | "runtime" | "review-only";

/** How many rules the register holds, by the strongest detector each carries. @public */
export interface RuleStats {
  readonly total: number;
  readonly byClass: Readonly<Record<DetectorClass, number>>;
}
