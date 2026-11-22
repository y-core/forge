// Generated from src/testing/zone.ts by `bun run gen:bundles` — do not edit.

// src/testing/zone.ts
var EXPRESSION_TOKEN = /\s*("(?:[^"\\]|\\.)*"|[(){},]|[A-Za-z_][\w.]*)/y;
var PATH_FIELD = "http.request.uri.path";
function tokenize(expression) {
  const tokens = [];
  EXPRESSION_TOKEN.lastIndex = 0;
  while (EXPRESSION_TOKEN.lastIndex < expression.length) {
    const at = EXPRESSION_TOKEN.lastIndex;
    const match = EXPRESSION_TOKEN.exec(expression);
    if (match?.[1] === void 0) {
      if (expression.slice(at).trim() === "") break;
      throw new Error(`zoneAllows: unrecognised syntax at character ${at} of ${expression}`);
    }
    tokens.push(match[1]);
  }
  return tokens;
}
function unescapeOnly(text, escapable, what) {
  return text.replace(/\\([\s\S]?)/g, (_, next) => {
    if (!escapable.includes(next) || next === "") throw new Error(`zoneAllows: ${what} holds an undocumented escape \\${next} in ${text}`);
    return next;
  });
}
function unquote(literal) {
  if (!literal.startsWith('"')) throw new Error(`zoneAllows: expected a quoted string, got ${literal}`);
  return unescapeOnly(literal.slice(1, -1), '"\\', "a quoted string");
}
function wildcardMatches(pattern, value, strict) {
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
function zoneAllows(expression, path) {
  const tokens = tokenize(expression);
  let at = 0;
  const take = (expected) => {
    const token = tokens[at++];
    if (token === void 0 || expected !== void 0 && token !== expected)
      throw new Error(`zoneAllows: expected ${expected ?? "a token"}, got ${token ?? "the end of the expression"}`);
    return token;
  };
  const field = () => {
    take(PATH_FIELD);
    return path;
  };
  const primary = () => {
    if (tokens[at] === "(") {
      take("(");
      const value3 = disjunction();
      take(")");
      return value3;
    }
    if (tokens[at] === "starts_with" || tokens[at] === "ends_with") {
      const name = take();
      take("(");
      const value3 = field();
      take(",");
      const affix = unquote(take());
      take(")");
      return name === "starts_with" ? value3.startsWith(affix) : value3.endsWith(affix);
    }
    const value2 = field();
    const operator = take();
    if (operator === "in") {
      take("{");
      const members = [];
      while (tokens[at] !== "}") members.push(unquote(take()));
      take("}");
      return members.includes(value2);
    }
    if (operator === "strict") {
      take("wildcard");
      return wildcardMatches(unquote(take()), value2, true);
    }
    if (operator === "wildcard") return wildcardMatches(unquote(take()), value2, false);
    if (operator === "contains") return value2.includes(unquote(take()));
    throw new Error(`zoneAllows: unrecognised operator ${operator}`);
  };
  const negation = () => {
    if (tokens[at] !== "not") return primary();
    take("not");
    return !negation();
  };
  const conjunction = () => {
    let value2 = negation();
    while (tokens[at] === "and") {
      take("and");
      value2 = negation() && value2;
    }
    return value2;
  };
  const disjunction = () => {
    let value2 = conjunction();
    while (tokens[at] === "or") {
      take("or");
      value2 = conjunction() || value2;
    }
    return value2;
  };
  const value = disjunction();
  if (at !== tokens.length) throw new Error(`zoneAllows: unrecognised syntax from ${tokens[at]}`);
  return value;
}
export {
  zoneAllows
};
