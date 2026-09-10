import type { ModernCssRuleId } from "../../lint/types";
import type { ModernCssReportedId } from "../../lint/types";
/** What the asset-manifest check needs to find the emitted module and the tree it describes. @public */
export interface AssetManifestCheckConfig {
  /** Application root. Both paths resolve against it. */
  root: string;
  /** Assets config path, relative to `root`. */
  assetConfig: string;
  /** The emitted module, relative to `root`. Defaults to `.forge/assets.ts`. */
  assetsPath?: string;
}

/** What the asset-root check needs to find both halves of the coupling. @public */
export interface AssetRootCheckConfig {
  /** Application root. Both config paths resolve against it. */
  root: string;
  /** Assets config path, relative to `root`. */
  assetConfig: string;
  /** Wrangler config path, relative to `root`. Defaults to `wrangler.jsonc`. */
  workerConfig?: string;
}

/** What the build-time-boundary check needs to know about the project. @public */
export interface BuildTimeBoundaryCheckConfig {
  /** Repository root; every reported path is relative to it. */
  root: string;
  /** The package name consumers import under, e.g. `@y-core/forge`. */
  packageName: string;
  /** The `exports` map, verbatim from `package.json` — which subpaths are build-time is *derived* from it. */
  exports: ExportsMap;
  /** Directories whose modules run on a developer's machine, relative to `root`. */
  buildTimeDirs: readonly string[];
  /** Directories walked for source files, relative to `root`. Defaults to `["src"]`. */
  sources?: readonly string[];
}

/** What a bundle-drift check needs to know about the project. @public */
export interface BundleCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** The TypeScript entry, relative to `root`. */
  entry: string;
  /** The committed bundle node loads, relative to `root`. */
  bundle: string;
  /** The command that regenerates the bundle, named in the banner and in every failure. */
  fixer: string;
}

/** One functional root's resolution: its named default, the value set that takes the other group, and its arbitrary-value groups. @public */
export interface RootRow {
  /** Group for a named value the design system did not enumerate; absent when the root takes no named value. */
  named?: string;
  /** The enumerated minority values, and the group they take. */
  exceptions?: { values: readonly string[]; group: string };
  /** Group for an arbitrary value whose kind is not listed in `kinds`. */
  arbitrary?: string;
  /** Arbitrary-value kinds that resolve to something other than `arbitrary`. */
  kinds?: Readonly<Record<string, string>>;
}

/** The derived table: every static utility, every functional root, and the override edges between groups. @public */
export interface ClassGroupTable {
  statics: ReadonlyMap<string, string>;
  roots: ReadonlyMap<string, RootRow>;
  overrides: ReadonlyMap<string, readonly string[]>;
}

/** What the class-groups check needs to know about the project. @public */
export interface ClassGroupsCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** The stylesheet the design system is compiled from, relative to `root`. */
  stylesheet: string;
  /** The generated module the derived table is committed to, relative to `root`. */
  table: string;
  /** `@utility` recipes whose payload is conditional, keyed into a slot no Tailwind utility reaches. */
  stateRecipes?: readonly string[];
}

/** What the class-order check needs to know about the project. @public */
export interface ClassOrderCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** Files and directories to scan, relative to `root`; a `!`-prefixed entry excludes a subtree. */
  sources: readonly string[];
}

/** What the class-token check needs to know about the project. @public */
export interface ClassTokensCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** Files and directories to scan, relative to `root`; a `!`-prefixed entry excludes a subtree. */
  sources: readonly string[];
  /** The stylesheet the design system is compiled from, relative to `root`. */
  stylesheet: string;
}

/** One string literal, with the line it opens on. */
export interface SourceLiteral {
  line: number;
  text: string;
}

/** What the co-location check needs to know about the project. @public */
export interface CoLocationCheckConfig {
  /** Repository root; every reported path is relative to it. */
  root: string;
  /** Directories walked for source modules, relative to `root`. */
  sources: readonly string[];
  /** Modules exempt from needing a co-located test, each `root`-relative posix path mapped to why. */
  exempt?: ReadonlyMap<string, string>;
}

/** A colour scheme the theme is audited in. */
export type Mode = "light" | "dark";

/** One `--foo: bar;` declaration, with where it was written. */
export interface Declaration {
  /** The declared value, whitespace-collapsed — e.g. `var(--gray-11)`. */
  value: string;
  /** 1-indexed line the declaration sits on. */
  line: number;
  /** Which stylesheet it came from. Set by `mergeThemes`; absent when a single sheet was parsed. */
  file?: string;
}

/** Every declaration in each mode's block, keyed by property. */
export interface ParsedTheme {
  light: Map<string, Declaration>;
  dark: Map<string, Declaration>;
}

/** One mode's half of a contract row: the value a step must carry, and the measurement against it. */
export interface AcceptedRow {
  /** The custom property the exemption is about. */
  token: string;
  /** The role step it resolves through. */
  step: string;
  /** The value the step is exempted at, per mode. */
  value: Readonly<Record<Mode, string>>;
  /** Worst-case measured ratios. */
  measured: string;
  /** Why no criterion binds. Mandatory and non-empty. */
  reason: string;
}

/** One side of an audited pair — the token whose resolved colour is measured. */
export interface ContrastSideInput {
  readonly token: string;
}

/** One audited pair — foreground and background tokens judged against a criterion. */
export interface ContrastPairInput {
  readonly token: string;
  readonly criterion: string;
  readonly foreground: ContrastSideInput;
  readonly background: ContrastSideInput;
}

/** A success criterion and the ratio it demands. */
export interface ContrastCriterion {
  readonly floor: number;
  readonly name: string;
}

/** What the contrast check needs to know about the project. @public */
export interface ContrastCheckConfig {
  root: string;
  /** Directory of stylesheets, relative to `root`. */
  cssDir: string;
  /** The token layer, in import order, relative to `root` — a pair may span multiple files, read as one cascade. */
  tokenFiles: readonly string[];
  /** The mapping layer, checked by one rule specifically. */
  mappingFile: string;
  /** The pairs to measure. */
  pairs: readonly ContrastPairInput[];
  /** Each criterion's floor and name, keyed as `pairs[].criterion` names them. */
  criteria: Readonly<Record<string, ContrastCriterion>>;
  /** Resolves the absolute path of an upstream palette stylesheet (e.g. Tailwind's `theme.css`); omit when no pair resolves through one. */
  palettePath?: () => string;
  /** Pairs the criteria do not bind, recorded with what they measure and why they are exempt. */
  accepted?: readonly AcceptedRow[];
}

/** Why a token could not be reduced to a colour. */
export interface Unresolved {
  token: string;
  at: string;
  reason: string;
}

/** One pair measured in one mode. */
export interface Measurement {
  token: string;
  mode: Mode;
  criterion: string;
  floor: number;
  foreground: string | Unresolved;
  background: string | Unresolved;
  ratio?: number;
}

/** A string literal that reads as a Tailwind class declaration. */
export interface ClassDeclaration {
  /** The literal as written, without its quotes. */
  literal: string;
  /** The tokens that made it read as classes — at least two, by construction. */
  anchors: string[];
}

/** What the `@source` coverage check needs to know about the project. @public */
export interface CssSourcesCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** The component root whose every subdirectory must be scanned or registered, relative to `root`. */
  uiDir: string;
  /** Directory of stylesheets whose `@source` directives are read, relative to `root`. */
  cssDir: string;
  /** Source root swept by pass C for class-bearing siblings, relative to `root`. */
  sourceDir: string;
  /** README that must publish each `consumerScanned` line verbatim, relative to `root`. */
  readme: string;
  /** Directories under `uiDir` that emit no utility class, each mapped to the reason — a claim pass B re-checks. */
  classFree?: ReadonlyMap<string, string>;
  /** Directories under `uiDir` that declare classes but are opt-in, each mapped to the exact `@source` line an app must add. */
  consumerScanned?: ReadonlyMap<string, string>;
}

/** What the theme-token namespace check needs to know about the project. @public */
export interface CssTokensCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** The stylesheet the design system is compiled from, relative to `root`. */
  stylesheet: string;
  /** Directory of stylesheets whose `@theme` blocks are read, relative to `root`. */
  cssDir: string;
}

/** A `<!-- rule:… -->` marker: the id as written, and where it was written. */
export interface RuleMarker {
  /** 1-indexed line the marker sits on. */
  line: number;
  /** The id exactly as written, including a malformed one. */
  id: string;
}

/** An `import { … } from "@y-core/forge/<subpath>"` the corpus writes. */
export interface BarrelImport {
  /** 1-indexed line the `import` keyword sits on. */
  line: number;
  /** The exports-map key form of the barrel — e.g. `./ui/core`. */
  subpath: string;
  /** The names the statement asks the barrel for, `type` markers stripped and `as` aliases resolved
   *  back to the exported name. */
  symbols: string[];
}

/** A `--foo` custom property the corpus names, and where. */
export interface CustomPropertyCitation {
  /** 1-indexed line the token sits on. */
  line: number;
  /** The property including its leading `--`. For a family, the prefix without the trailing `-*`. */
  property: string;
  /** True when the corpus named a *family* (`--palette-*`) rather than one property. */
  family: boolean;
}

/** One class-shaped string literal and the line it starts on. */
export interface ClassLiteral {
  /** 1-indexed line the literal's opening quote sits on. */
  line: number;
  /** The literal's contents, quotes stripped. */
  text: string;
}

/** A class position the scan dropped because its span never closes. */
export interface SkippedClassPosition {
  /** 1-indexed line the position starts on. */
  line: number;
  /** The position as written: up to its opening bracket, or the line the unclosed literal opens on. */
  text: string;
}

/** The design-system facts the plugin's class-string rules resolve against. @public */
export interface DesignScale {
  /** The `--spacing` step size, verbatim — e.g. `0.25rem`. */
  spacingUnit: string;
  /** Every utility root whose named value is a multiple of `--spacing`, sign folded off. */
  spacingRoots: readonly string[];
  /** Every multiplier the scale enumerates, ascending. */
  spacingSteps: readonly string[];
  /** Every utility root that resolves a `--color-*` theme entry. */
  colorRoots: readonly string[];
  /** Every colour token the theme declares, `--color-` stripped. */
  colorTokens: readonly string[];
}

/** What the design-scale check needs to know about the project. @public */
export interface DesignScaleCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** The stylesheet the design system is compiled from, relative to `root`. */
  stylesheet: string;
  /** The generated module the derived scale is committed to, relative to `root`. */
  table: string;
}

/** A node of the AST `candidatesToAst` returns; only the shapes a derivation reads are named. @public */
export interface CssNode {
  kind: string;
  property?: string;
  name?: string;
  nodes?: readonly CssNode[];
}

/** The subset of Tailwind's design system forge's derivations call. @public */
export interface DesignSystem {
  candidatesToAst: (candidates: string[]) => readonly (readonly CssNode[] | null)[];
  candidatesToCss: (candidates: string[]) => readonly (string | null)[];
  parseCandidate: (candidate: string) => Iterable<{ kind: string; root: string; value?: { kind: string; value: string } | null }>;
  getClassList: () => readonly (readonly [string, unknown])[];
  utilities: { keys: (kind: "static" | "functional") => readonly string[] };
  theme: { entries: () => Iterable<readonly [string, { value: string }]> };
}

/** A package's `exports` map as it appears in `package.json`. */
export type ExportsMap = Record<string, { import?: string; types?: string } | string>;

/** What the exports check needs to know about the project. @public */
export interface ExportsCheckConfig {
  /** Application root. Every path is resolved against it, and reported relative to it. */
  root: string;
  /** The package name consumers import under, e.g. `@y-core/forge`. */
  packageName: string;
  /** The `exports` map, verbatim from `package.json`. */
  exports: ExportsMap;
  /** The `files` array, verbatim from `package.json`. */
  files: readonly string[];
  /** Directory scanned for source barrels, relative to `root`. Defaults to `"src"`. */
  sourceDir?: string;
  /** Further subpaths whose runtime import is skipped because loading them touches DOM globals.
   *  A subpath under a `client` segment is derived; this is for one that is browser-only under another name. */
  browserOnly?: readonly string[];
  /** Subpaths that intentionally export no value, because they mutate globals or register once. */
  sideEffectOnly?: readonly string[];
  /** Barrels that are intentionally unpublished because every symbol is `@internal`. */
  sealedInternal?: readonly string[];
  /** Directories of non-module assets whose every member must resolve for a consumer. */
  assetDirs?: readonly { dir: string; extension: string }[];
}

/** What the JSX check needs to know about the project. @public */
export interface JsxCheckConfig {
  /** Repository root; every reported path is relative to it. */
  root: string;
  /** Directories walked for `.tsx` files, relative to `root`. Defaults to `["src"]`. */
  sources?: readonly string[];
  /** Pragma lines every shipped `.tsx` file must contain, matched as substrings; defaults to forge's own pair. */
  pragmas?: readonly string[];
}

/** How a line was classified; a `fence`, `frontmatter` or `indented-code` line is never rewritten. @public */
export type MarkdownLineKind =
  | "blank"
  | "frontmatter"
  | "fence"
  | "fence-marker"
  | "heading"
  | "setext-underline"
  | "thematic-break"
  | "blockquote"
  | "html"
  | "indented-code"
  | "table"
  | "list-item"
  | "paragraph";

/** A fenced code block, from its opening marker to its closing one, both 1-indexed and inclusive. @public */
export interface FenceSpan {
  start: number;
  end: number;
  /** The run of backticks or tildes the fence opened with. */
  marker: string;
  /** Leading whitespace of the opening marker. */
  indent: string;
  /** The info string as written — the language tag, or `""` for a bare fence. */
  info: string;
}

/** One row of a table, split into its raw cell texts. @public */
export interface TableRow {
  line: number;
  kind: "header" | "delimiter" | "body";
  cells: readonly string[];
}

/** A GFM table: a header row, its delimiter row, and the body rows under them. @public */
export interface TableBlock {
  start: number;
  end: number;
  indent: string;
  rows: readonly TableRow[];
}

/** One list item, with the items nested under it. @public */
export interface ListItem {
  line: number;
  /** Last line belonging to this item, including its continuations and children. */
  end: number;
  /** Columns of leading whitespace before the marker. */
  indent: number;
  /** The marker as written — `-`, `*`, `+`, or `1.` / `1)`. */
  marker: string;
  ordered: boolean;
  /** Column the item's content starts at, which is the indent its children are expected to hold. */
  contentColumn: number;
  children: readonly ListItem[];
}

/** An ATX or setext heading. @public */
export interface Heading {
  line: number;
  level: number;
  text: string;
  setext: boolean;
}

/** A block the blank-line rule applies to, at the top level of the document. @public */
export interface BlockSpan {
  kind: "heading" | "fence" | "table" | "list" | "blockquote";
  start: number;
  end: number;
}

/** One markdown document, classified line by line. @public */
export interface MarkdownDoc {
  lines: readonly string[];
  /** Parallel to `lines`, 0-indexed. */
  kinds: readonly MarkdownLineKind[];
  /** 1-indexed inclusive span of the YAML frontmatter, when the document opens with one. */
  frontmatter?: { start: number; end: number };
  fences: readonly FenceSpan[];
  tables: readonly TableBlock[];
  /** The top-level list items; nested ones hang off `children`. */
  lists: readonly ListItem[];
  headings: readonly Heading[];
  blocks: readonly BlockSpan[];
}

/** Which delimiters emphasis is written with. @public */
export interface EmphasisRule {
  strong: "**" | "__";
  em: "_" | "*";
}

/** How code fences are written, and what their info strings must say. @public */
export interface FenceRule {
  style: "backtick" | "tilde";
  /** Reports a fence with no language. Report-only: a fixer cannot guess one. */
  requireLanguage: boolean;
  /** Info strings rewritten to the corpus's majority spelling, e.g. `typescript` → `ts`. */
  aliases: Readonly<Record<string, string>>;
}

/** How much trailing whitespace survives. @public */
export interface TrailingWhitespaceRule {
  /** Width of a hard line break to preserve; every other trailing run is trimmed. */
  allowHardBreak: number;
}

/** Where over-long lines are reported, and how loudly. @public */
export interface LineLengthRule {
  limit: number;
  level: "fail" | "warn";
  /** Path prefixes the rule applies to; absent, it applies everywhere. */
  scope?: readonly string[];
}

/** The house markdown conventions. Every key is optional, and every one accepts `"off"`. @public */
export interface MarkdownRules {
  /** Collapse table cell padding to one space per side. */
  tables?: "compact" | "off";
  bulletMarker?: "-" | "*" | "+" | "off";
  orderedMarker?: "." | ")" | "off";
  /** Indent a nested list item to its parent's content column. */
  listIndent?: "content-column" | "off";
  emphasis?: EmphasisRule | "off";
  fence?: FenceRule | "off";
  hardTabs?: "forbid" | "off";
  trailingWhitespace?: TrailingWhitespaceRule | "off";
  thematicBreak?: "---" | "***" | "___" | "off";
  /** Reports reference-style links. Report-only. */
  linkStyle?: "inline" | "off";
  /** Reports a URL written without `<>` or a link. Report-only. */
  bareUrls?: "warn" | "fail" | "off";
  /** Reports a second level-1 heading. Report-only. */
  singleH1?: boolean;
  /** Block kinds that must be surrounded by a blank line. */
  blankLineAround?: readonly BlockSpan["kind"][] | "off";
  lineLength?: LineLengthRule | false;
}

/** Every rule resolved, with the library defaults applied. @public */
export type ResolvedMarkdownRules = Required<Omit<MarkdownRules, "lineLength">> & { lineLength: LineLengthRule | false };

/** What the markdown check needs to know about the project. @public */
export interface MarkdownCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** Files and directories to scan, relative to `root`; a `!`-prefixed entry excludes a subtree. Defaults to `["src"]`. */
  sources?: readonly string[];
  /** Further subtrees or files to exclude — generated trees another tool owns the bytes of. */
  exclude?: readonly string[];
  /** Overrides of the house conventions; every key is optional. */
  rules?: MarkdownRules;
}

/** One rule a path is not yet held to, and the task that owes the migration. @public */
export interface DeferredFinding {
  /** Repo-relative file, or the directory prefix, the deferral covers. */
  path: string;
  ruleId: ModernCssRuleId;
  /** The ledger task that closes it. Mandatory and non-empty. */
  owner: string;
}

/** One modern-platform rule violated at one place. @public */
export interface ModernCssFinding {
  /** Repo-relative path of the file the violation sits in. */
  file: string;
  /** 1-indexed line. */
  line: number;
  ruleId: ModernCssReportedId;
  detail: string;
}

/** A declaration block — one with no nested block of its own — and the at-rules enclosing it. @public */
export interface CssBlock {
  /** The selector or at-rule prelude, whitespace collapsed. */
  prelude: string;
  /** The text between the braces. */
  body: string;
  /** Offset of the first character of `body`. */
  start: number;
  /** The preludes of every enclosing block, outermost first. */
  ancestors: string[];
}

/** What the modern-CSS check needs to know about the project. @public */
export interface ModernCssCheckConfig {
  /** Application root. Every reported path is relative to it. */
  root: string;
  /** Files and directories to scan, relative to `root`; a `!`-prefixed entry excludes a subtree. */
  sources: readonly string[];
  /** The shrink-only deferral list. Defaults to forge's own, which a consuming app replaces. */
  deferred?: readonly DeferredFinding[];
}

/** Whether an edge survives type erasure. A `type` edge exists only in the type checker. */
export type EdgeKind = "value" | "type";

/** One import site: a single specifier as it appears in one file. */
export interface ImportRef {
  /** 1-indexed line, for the failure message. */
  line: number;
  /** The specifier exactly as written. */
  specifier: string;
  /** `type` only when every binding at this site is type-only. */
  kind: EdgeKind;
}

/** A file handed to the graph builder, already read by the caller. */
export interface SourceFile {
  /** Repo-relative posix path, e.g. `src/ui/core/card.tsx`. */
  path: string;
  /** The file's full text. */
  source: string;
}

/** One namespace-to-namespace edge, as observed across every contributing site. */
export interface ObservedEdge {
  /** `value` if any contributing site was a value import; `type` only if all of them were. */
  kind: EdgeKind;
  /** A site consistent with `kind`, chosen at the kind finally reported. */
  file: string;
  /** 1-indexed line within `file`. */
  line: number;
}

/** The graph as declared: the primitive set, the leaf set, and every intended edge. */
export interface DeclaredGraph {
  /** Namespaces exempt as an import *target*; an edge out of one is a closure violation. */
  primitives: readonly string[];
  /** Namespaces declared to have no cross-namespace edge at all. */
  leaf: readonly string[];
  /** Source namespace → target namespace → the declared kind. */
  edges: Record<string, Record<string, EdgeKind>>;
}

/** The six ways the observed tree and the declaration can disagree. */
export type GraphFindingKind = "undeclared-edge" | "absent-edge" | "leaf-edge" | "kind-mismatch" | "primitive-escape" | "unknown-namespace";

/** One disagreement, with the site that proves it where the observed tree supplies one. */
export interface GraphFinding {
  kind: GraphFindingKind;
  /** The source namespace, or the namespace the declaration names. */
  from: string;
  /** The target namespace, absent only when the finding is about `from` alone. */
  to?: string;
  /** Repo-relative path of the first offending site. */
  file?: string;
  /** 1-indexed line within `file`. */
  line?: number;
  /** Reason and remedy, ready to print after the caller's subject. */
  detail: string;
}

/** The four ways the document can carry an enumeration the data files own. */
export type EnumerationFindingKind = "missing-catalog-section" | "missing-classification-section" | "composes-table" | "classification-column";

/** One enumeration finding, carrying no message because its remedy is a fixed string the caller emits. */
export interface EnumerationFinding {
  kind: EnumerationFindingKind;
  /** 1-indexed line, or null for a missing section. */
  line: number | null;
}

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

/** One subpath section of a README, located by the `> Import path:` line that opens it. */
export interface ImportPathAnchor {
  /** The exports-map key form of the subpath — e.g. `./ui/controls`. */
  subpath: string;
  /** The barrel the anchor points at, repo-relative as written — e.g. `src/ui/controls/mod.ts`. */
  barrel: string;
  /** 1-indexed line the anchor itself sits on. */
  line: number;
  /** 1-indexed line of the `##` heading the anchor belongs to. */
  sectionStart: number;
  /** 1-indexed line the next `##` heading sits on, or one past the last line. Exclusive. */
  sectionEnd: number;
}

/** One symbol a documentation table or a `**Types:**` sentence names, and where it was named. */
export interface DocumentedSymbol {
  name: string;
  /** 1-indexed line the symbol was written on. */
  line: number;
}

/** What the SSR-boundary check needs to know about the project. @public */
export interface SsrBoundaryCheckConfig {
  /** Repository root; every reported path is relative to it. */
  root: string;
  /** The browser-only directories, relative to `root` — nothing outside them may import from within one. */
  clientDirs: readonly string[];
  /** Directories walked for source files, relative to `root`. */
  sources: readonly string[];
  /** Basenames permitted to cross the boundary; the registration entry points. */
  entryPoints: readonly string[];
}
