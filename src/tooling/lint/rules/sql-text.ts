import type { AstNode, TemplateLiteralNode } from "../types.ts";

/** A `tag\`…\`` expression: the tag it calls, and the template it hands over. */
interface TaggedTemplateNode extends AstNode {
  tag: AstNode & { name?: string | undefined };
  quasi: TemplateLiteralNode;
}

const LEADING_NOISE = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/;

/** The `sql` template's text with each interpolation read as `?`, its leading whitespace and comments dropped; `undefined` for any other tag. @internal */
export function sqlTemplateText(node: AstNode): string | undefined {
  const tagged = node as TaggedTemplateNode;
  if (tagged.tag?.type !== "Identifier" || tagged.tag.name !== "sql") return undefined;
  return tagged.quasi.quasis
    .map((quasi) => quasi.value.cooked ?? quasi.value.raw)
    .join("?")
    .replace(LEADING_NOISE, "");
}

const STATEMENT_KEYWORD = /^(SELECT|INSERT|REPLACE|UPDATE|DELETE|VALUES)\b/i;

const PROSE = /'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;

/** The statement's verb, reading past a `WITH` clause to the statement its common table expressions feed; strings, quoted names and comments are blanked first. @internal */
export function sqlStatementVerb(sql: string): string | undefined {
  const text = sql.replace(PROSE, (match) => " ".repeat(match.length));
  if (!/^WITH\b/i.test(text)) return /^(\w+)/.exec(text)?.[1]?.toUpperCase();
  let depth = 0;
  for (let i = 4; i < text.length; i += 1) {
    const char = text[i];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (depth === 0 && /\w/.test(char ?? "") && !/\w/.test(text[i - 1] ?? "")) {
      const verb = STATEMENT_KEYWORD.exec(text.slice(i))?.[1];
      if (verb !== undefined) return verb.toUpperCase();
    }
  }
  return undefined;
}
