/** A line/column pair, line 1-indexed and column 0-indexed, as oxlint reports them. */
export interface LineColumn {
  line: number;
  column: number;
}

/** The span of a node, as `node.loc`. */
export interface SourceLocation {
  start: LineColumn;
  end: LineColumn;
}

/** The part of an ESTree node every forge rule can rely on. */
export interface AstNode {
  type: string;
  loc: SourceLocation;
  /** The enclosing node, `null` at the root. */
  parent?: AstNode | null | undefined;
}

/** A string, number, boolean, null or regexp literal; only a `string` value is class text. */
export interface LiteralNode extends AstNode {
  value: unknown;
}

/** An identifier — a call's callee, or a JSX attribute's name. */
export interface IdentifierNode extends AstNode {
  name: string;
}

/** One `name=value` pair on a JSX opening element. */
export interface JsxAttributeNode extends AstNode {
  name?: (AstNode & { name?: string | undefined }) | undefined;
  value?: AstNode | null | undefined;
}

/** One `key: value` pair of an object literal — how a forge component is handed its `class` prop. */
export interface PropertyNode extends AstNode {
  key?: (AstNode & { name?: string | undefined; value?: unknown }) | undefined;
}

/** A call, whose callee decides whether its arguments are class text. */
export interface CallNode extends AstNode {
  callee: AstNode;
  arguments: readonly AstNode[];
}

/** One literal chunk of a template, between two interpolations. */
export interface TemplateElementNode extends AstNode {
  value: { cooked?: string | null | undefined; raw: string };
}

/** One `name = value` binding of a variable declaration. */
export interface VariableDeclaratorNode extends AstNode {
  id?: AstNode | undefined;
  init?: AstNode | null | undefined;
}

/** A template literal, read one interpolation-delimited chunk at a time. */
export interface TemplateLiteralNode extends AstNode {
  quasis: readonly TemplateElementNode[];
}

/** One `oxlint-disable*` comment, as the linter parsed it. */
export interface DisableDirective {
  /** Which form of directive it is — `disable`, `disable-line`, `disable-next-line`, `enable`. */
  type: string;
  /** The rules it names, or the empty string when it suppresses everything. */
  value: string;
  /** The text after `--`, empty when the author wrote none. */
  justification: string;
  node: unknown;
}

/** What a rule is handed for the file under lint. */
export interface RuleContext {
  report: (diagnostic: { message: string; node?: unknown; loc?: SourceLocation }) => void;
  sourceCode: { getDisableDirectives: () => { directives: readonly DisableDirective[] } };
}

/** The node handlers a rule returns, keyed by node type or `<type>:exit`. */
export type Visitor = Record<string, (node: AstNode) => void>;

/** A rule as oxlint loads it. */
export interface LintRule {
  meta?: { type?: "problem" | "suggestion" | "layout"; docs?: { description?: string } };
  create: (context: RuleContext) => Visitor;
}

/** A plugin as oxlint loads it. */
export interface LintPlugin {
  meta: { name: string };
  rules: Record<string, LintRule>;
}

/** One piece of class text: the node it was read from, its contents, and where it starts. */
export interface ClassText {
  node: AstNode;
  text: string;
  loc: SourceLocation;
}

/** A rule the design corpus states and this tooling enforces. @public */
export type RuleId =
  | "forge-ui-color-token-only"
  | "forge-ui-color-theme-no-raw-utility"
  | "forge-ui-no-inline-style"
  | "forge-ui-spacing-scale-only"
  | "forge-ui-no-nested-card"
  | "forge-ui-interaction-focus-visible"
  | "forge-ui-catalog-wrong-raw-input"
  | "forge-ui-contrast-floor"
  | "forge-ui-a11y-label-association"
  | "forge-ui-a11y-live-politeness"
  | "forge-ui-a11y-no-aria-readonly-on-button"
  | "forge-ui-a11y-one-live-region"
  | "forge-ui-a11y-aria-beside-data"
  | "forge-ui-a11y-heading-size-by-class"
  | "forge-ui-reduced-motion"
  | "forge-ui-focus-ring"
  | "forge-ui-optional-prop-undefined";

/** Which mechanism enforces a rule: `validate-design`'s source detectors, forge's oxlint plugin, or
 *  `validate-contrast`, which measures resolved colours rather than reading source at all. @public */
export type RuleEnforcer = "gate" | "lint" | "contrast";

/** A JSX opening element and the attributes it carries, in source order. */
export interface JsxOpeningElementNode extends AstNode {
  name?: AstNode | undefined;
  attributes?: readonly AstNode[] | undefined;
}

/** A modern-platform CSS rule this check enforces. @public */
export type ModernCssRuleId =
  | "forge-ui-platform-aspect-ratio"
  | "forge-ui-platform-centering"
  | "forge-ui-platform-image-set"
  | "forge-ui-platform-isolation"
  | "forge-ui-platform-light-dark"
  | "forge-ui-platform-line-clamp"
  | "forge-ui-platform-logical-spacing"
  | "forge-ui-platform-scrollbar"
  | "forge-ui-platform-native-dialog"
  | "forge-ui-platform-native-popover"
  | "forge-ui-platform-native-details"
  | "forge-ui-platform-entry-motion"
  | "forge-ui-platform-parent-state"
  | "forge-ui-platform-inert"
  | "forge-ui-platform-theme-detection"
  | "forge-ui-platform-smooth-scroll"
  | "forge-ui-platform-ticker"
  | "forge-ui-platform-counters"
  | "forge-ui-platform-count-up"
  | "forge-ui-platform-animated-border"
  | "forge-ui-platform-motion-path"
  | "forge-ui-platform-reveal-mask"
  | "forge-ui-platform-scroll-reveal"
  | "forge-ui-platform-carousel"
  | "forge-ui-platform-field-sizing"
  | "forge-ui-platform-anchor-positioning"
  | "forge-ui-platform-layer"
  | "forge-ui-platform-nesting"
  | "forge-ui-platform-container-query"
  | "forge-ui-platform-subgrid"
  | "forge-ui-platform-selector-list"
  | "forge-ui-platform-accent-color"
  | "forge-ui-platform-view-transition"
  | "forge-ui-platform-text-balance"
  | "forge-ui-platform-text-pretty"
  | "forge-ui-platform-field-sizing-adopt"
  | "forge-ui-platform-interpolate-size"
  | "forge-ui-platform-scope"
  | "forge-ui-platform-display-contents"
  | "forge-ui-platform-color-mix";

// `UI_DESIGN_GUIDANCE.md` §3b makes a rule id permanent and corpus-unique, so a pattern the corpus
// already names is reported under the id it already has rather than under a second one here.
/** Rule ids the design corpus owns, which this check reports under rather than minting again. @public */
export type ModernCssCitedRuleId = Extract<RuleId, "forge-ui-interaction-focus-visible">;

/** Any id this check reports a finding under. @public */
export type ModernCssReportedId = ModernCssRuleId | ModernCssCitedRuleId;

/** How a rule is detected: `A` is textual, `B` and `C` need rendered behaviour. @public */
export type ModernCssTier = "A" | "B" | "C";

/** What the check knows about one rule beyond how to detect it. @public */
export interface ModernCssRule {
  tier: ModernCssTier;
  severity: "fail" | "warn";
  /** The corpus file that states the rule. */
  corpus: string;
  /** The platform feature that replaces the pattern. */
  replacement: string;
  /** What has to be confirmed by hand before taking the replacement. */
  verify: string;
  /** Which mechanism enforces it. Absent means `"gate"` — a detector in this check. */
  enforcer?: RuleEnforcer;
}

/** Any id a plugin rule reports under: a corpus rule, or one of the modern-platform rules. */
export type ReportedId = RuleId | ModernCssRuleId;
