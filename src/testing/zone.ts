const EXPRESSION_TOKEN = /\s*("(?:[^"\\]|\\.)*"|[(){},]|[A-Za-z_][\w.]*)/y;

const PATH_FIELD = "http.request.uri.path";

function tokenize(expression: string): string[] {
  const tokens: string[] = [];
  EXPRESSION_TOKEN.lastIndex = 0;
  while (EXPRESSION_TOKEN.lastIndex < expression.length) {
    const at = EXPRESSION_TOKEN.lastIndex;
    const match = EXPRESSION_TOKEN.exec(expression);
    if (match?.[1] === undefined) {
      if (expression.slice(at).trim() === "") break;
      throw new Error(`zoneAllows: unrecognised syntax at character ${at} of ${expression}`);
    }
    tokens.push(match[1]);
  }
  return tokens;
}

function unescapeOnly(text: string, escapable: string, what: string): string {
  return text.replace(/\\([\s\S]?)/g, (_, next: string) => {
    if (!escapable.includes(next) || next === "") throw new Error(`zoneAllows: ${what} holds an undocumented escape \\${next} in ${text}`);
    return next;
  });
}

function unquote(literal: string): string {
  if (!literal.startsWith('"')) throw new Error(`zoneAllows: expected a quoted string, got ${literal}`);
  return unescapeOnly(literal.slice(1, -1), '"\\', "a quoted string");
}

function wildcardMatches(pattern: string, value: string, strict: boolean): boolean {
  let source = "";
  let previousWasStar = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern.charAt(i);
    if (char === "*") {
      if (previousWasStar) throw new Error(`zoneAllows: ** is invalid in the wildcard ${pattern}`);
      source += ".*";
      previousWasStar = true;
      continue;
    }
    previousWasStar = false;
    const literal = char === "\\" ? unescapeOnly(pattern.slice(i, i + 2), "*\\", "a wildcard") : char;
    if (char === "\\") i += 1;
    source += literal.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, strict ? "s" : "is").test(value);
}

/** Answers whether a `buildAllowExpression` predicate admits `path`, throwing on Ruleset Engine syntax it does not evaluate. @public */
export function zoneAllows(expression: string, path: string): boolean {
  const tokens = tokenize(expression);
  let at = 0;
  const take = (expected?: string): string => {
    const token = tokens[at++];
    if (token === undefined || (expected !== undefined && token !== expected))
      throw new Error(`zoneAllows: expected ${expected ?? "a token"}, got ${token ?? "the end of the expression"}`);
    return token;
  };
  const field = (): string => {
    take(PATH_FIELD);
    return path;
  };
  const primary = (): boolean => {
    if (tokens[at] === "(") {
      take("(");
      const value = disjunction();
      take(")");
      return value;
    }
    if (tokens[at] === "starts_with" || tokens[at] === "ends_with") {
      const name = take();
      take("(");
      const value = field();
      take(",");
      const affix = unquote(take());
      take(")");
      return name === "starts_with" ? value.startsWith(affix) : value.endsWith(affix);
    }
    const value = field();
    const operator = take();
    if (operator === "in") {
      take("{");
      const members: string[] = [];
      while (tokens[at] !== "}") members.push(unquote(take()));
      take("}");
      return members.includes(value);
    }
    if (operator === "strict") {
      take("wildcard");
      return wildcardMatches(unquote(take()), value, true);
    }
    if (operator === "wildcard") return wildcardMatches(unquote(take()), value, false);
    if (operator === "contains") return value.includes(unquote(take()));
    throw new Error(`zoneAllows: unrecognised operator ${operator}`);
  };
  const negation = (): boolean => {
    if (tokens[at] !== "not") return primary();
    take("not");
    return !negation();
  };
  const conjunction = (): boolean => {
    let value = negation();
    while (tokens[at] === "and") {
      take("and");
      value = negation() && value;
    }
    return value;
  };
  const disjunction = (): boolean => {
    let value = conjunction();
    while (tokens[at] === "or") {
      take("or");
      value = conjunction() || value;
    }
    return value;
  };
  const value = disjunction();
  if (at !== tokens.length) throw new Error(`zoneAllows: unrecognised syntax from ${tokens[at]}`);
  return value;
}
