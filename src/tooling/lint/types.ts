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
