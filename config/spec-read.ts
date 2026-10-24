interface Token {
  kind: "ident" | "string" | "template" | "substitution" | "punct" | "other";
  text: string;
  line: number;
  /** The decoded value of a string or a substitution-free template. */
  value?: string;
}

type Value = { kind: "string"; value: string } | { kind: "object"; props: Prop[] };

type Prop =
  | { kind: "spread"; from: number; to: number }
  | { kind: "property"; key: string | undefined; from: number; to: number }
  | { kind: "shorthand"; key: string; at: number }
  | { kind: "other"; key: string | undefined };

/** What one spec hands the fixture through `mount` and `bundleModules`, and names through `new URL(…, import.meta.url)`. */
export interface SpecReferences {
  specifiers: string[];
  urls: string[];
}

const REGEX_AFTER_PUNCT = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^", "=>"]);

const REGEX_AFTER_WORD = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "instanceof",
  "yield",
  "await",
]);

const CONTINUES = new Set([".", "?.", "?", ":", "+", "-", "*", "/", "%", "&", "|", "^", "=", "<", ">", "!", "=>", "as", "satisfies"]);

class Unreadable extends Error {}

function startsRegex(previous: Token | undefined): boolean {
  if (previous === undefined) return true;
  if (previous.kind === "punct") return REGEX_AFTER_PUNCT.has(previous.text);
  return previous.kind === "ident" && REGEX_AFTER_WORD.has(previous.text);
}

function decodeString(body: string): string {
  return body.replace(/\\(.)/gs, (_, ch: string) => ({ n: "\n", t: "\t", r: "\r", "0": "\0" })[ch] ?? ch);
}

// A template's substitutions are code, so they are tokenized like any other and only the literal is opaque.
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const depths: number[] = [];
  let line = 1;
  let i = 0;
  const push = (token: Omit<Token, "line">, at: number): void => {
    tokens.push({ ...token, line });
    line += (source.slice(at, i).match(/\n/g) ?? []).length;
  };
  const readTemplate = (start: number): void => {
    let text = "";
    while (i < source.length && source[i] !== "`") {
      if (source[i] === "\\") {
        text += source.slice(i, i + 2);
        i += 2;
      } else if (source.startsWith("${", i)) {
        i += 2;
        push({ kind: "substitution", text: "${" }, start);
        depths.push(0);
        return;
      } else text += source[i++];
    }
    i++;
    push({ kind: "template", text, value: decodeString(text) }, start);
  };
  while (i < source.length) {
    const start = i;
    const ch = source[i] ?? "";
    if (ch === "\n") {
      line++;
      i++;
    } else if (/\s/.test(ch)) i++;
    else if (source.startsWith("//", i)) i = source.indexOf("\n", i) === -1 ? source.length : source.indexOf("\n", i);
    else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      line += (source.slice(start, i).match(/\n/g) ?? []).length;
    } else if (ch === '"' || ch === "'") {
      i++;
      while (i < source.length && source[i] !== ch && source[i] !== "\n") i += source[i] === "\\" ? 2 : 1;
      i++;
      push({ kind: "string", text: source.slice(start, i), value: decodeString(source.slice(start + 1, i - 1)) }, start);
    } else if (ch === "`") {
      i++;
      readTemplate(start);
    } else if (ch === "}" && depths.length > 0 && depths.at(-1) === 0) {
      depths.pop();
      i++;
      push({ kind: "substitution", text: "}" }, start);
      readTemplate(i);
    } else if (/[A-Za-z_$]/.test(ch)) {
      while (i < source.length && /[\w$]/.test(source[i] ?? "")) i++;
      push({ kind: "ident", text: source.slice(start, i) }, start);
    } else if (/[0-9]/.test(ch)) {
      while (i < source.length && /[\w.]/.test(source[i] ?? "")) i++;
      push({ kind: "other", text: source.slice(start, i) }, start);
    } else if (ch === "/" && startsRegex(tokens.at(-1))) {
      let inClass = false;
      i++;
      while (i < source.length && source[i] !== "\n" && (inClass || source[i] !== "/")) {
        if (source[i] === "\\") i++;
        else if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        i++;
      }
      i++;
      while (/[a-z]/.test(source[i] ?? "")) i++;
      push({ kind: "other", text: source.slice(start, i) }, start);
    } else {
      const multi = ["...", "?.", "=>"].find((op) => source.startsWith(op, i));
      i += multi?.length ?? 1;
      if (depths.length > 0 && (ch === "{" || ch === "}")) depths[depths.length - 1] = (depths.at(-1) ?? 0) + (ch === "{" ? 1 : -1);
      push({ kind: "punct", text: multi ?? ch }, start);
    }
  }
  return tokens;
}

/** Reads every `mount`, `bundleModules` and `new URL(…, import.meta.url)` site in `source`; throws, naming the line, on any it cannot read whole. */
export function readSpecReferences(source: string, file: string): SpecReferences {
  const tokens = tokenize(source);
  const at = (index: number): Token | undefined => tokens[index];
  const fail = (index: number, what: string): never => {
    throw new Unreadable(`${file}:${at(index)?.line ?? "?"}: ${what} cannot be read whole; pass the fixture an object literal of string literals`);
  };
  const isOpen = (t: Token | undefined): boolean =>
    (t?.kind === "punct" && ["(", "[", "{"].includes(t.text)) || (t?.kind === "substitution" && t.text === "${");
  const isClose = (t: Token | undefined): boolean =>
    (t?.kind === "punct" && [")", "]", "}"].includes(t.text)) || (t?.kind === "substitution" && t.text === "}");

  const closing = (open: number): number => {
    let depth = 0;
    for (let j = open; j < tokens.length; j++) {
      if (isOpen(at(j))) depth++;
      else if (isClose(at(j)) && --depth === 0) return j;
    }
    return fail(open, "an unclosed bracket");
  };

  // The tokens of one expression from `from`: up to a comma, a semicolon or a closing bracket at depth 0, or a line no operator continues.
  const expressionEnd = (from: number): number => {
    let j = from;
    while (j < tokens.length) {
      const t = at(j);
      if (t === undefined || (t.kind === "punct" && [",", ";"].includes(t.text)) || isClose(t)) return j;
      j = isOpen(t) ? closing(j) + 1 : j + 1;
      const next = at(j);
      const ended = next !== undefined && next.line > (at(j - 1)?.line ?? 0) && !CONTINUES.has(next.text) && !isOpen(next);
      if (ended) return j;
    }
    return j;
  };

  const consts = new Map<string, { from: number; to: number } | "ambiguous">();
  tokens.forEach((t, j) => {
    if (t.text !== "const" || at(j + 1)?.kind !== "ident") return;
    const name = at(j + 1)?.text ?? "";
    let eq = j + 2;
    while (eq < tokens.length && !["=", ";", ")", "of", "in"].includes(at(eq)?.text ?? "")) eq = isOpen(at(eq)) ? closing(eq) + 1 : eq + 1;
    const bound = at(eq)?.text === "=" && !consts.has(name);
    consts.set(name, bound ? { from: eq + 1, to: expressionEnd(eq + 1) } : "ambiguous");
  });

  const evaluate = (from: number, to: number, seen: readonly string[] = []): Value => {
    let end = from;
    while (end < to && !(end > from && (at(end)?.text === "as" || at(end)?.text === "satisfies")))
      end = isOpen(at(end)) ? closing(end) + 1 : end + 1;
    while (at(from)?.text === "(" && closing(from) === end - 1) return evaluate(from + 1, end - 1, seen);
    const first = at(from);
    if (end - from === 1 && first?.value !== undefined && (first.kind === "string" || first.kind === "template"))
      return { kind: "string", value: first.value };
    if (first?.text === "{" && closing(from) === end - 1) return { kind: "object", props: readProps(from) };
    if (first?.kind !== "ident") return fail(from, "an expression");
    const path = [first.text];
    let j = from + 1;
    while (j < end && at(j)?.text === "." && at(j + 1)?.kind === "ident") {
      path.push(at(j + 1)?.text ?? "");
      j += 2;
    }
    if (j !== end) return fail(from, `\`${first.text}\` followed by more than property reads`);
    const declared = consts.get(first.text);
    if (declared === undefined || declared === "ambiguous" || seen.includes(first.text))
      return fail(from, `\`${first.text}\`, which is not one local const,`);
    return path.slice(1).reduce((value, key) => member(value, key, from), evaluate(declared.from, declared.to, [...seen, first.text]));
  };

  const lookup = (value: Value, key: string, site: number): Value | undefined => {
    if (value.kind !== "object") return fail(site, `\`.${key}\` of a string`);
    let found: Value | undefined;
    for (const prop of value.props) {
      if (prop.kind === "spread") found = lookup(objectAt(prop.from, prop.to), key, site) ?? found;
      else if (prop.key === undefined || (prop.kind === "other" && prop.key === key))
        return fail(site, `\`.${key}\` past a computed or method member`);
      else if (prop.key === key && prop.kind === "shorthand") found = evaluate(prop.at, prop.at + 1);
      else if (prop.key === key && prop.kind === "property") found = evaluate(prop.from, prop.to);
    }
    return found;
  };

  const member = (value: Value, key: string, site: number): Value =>
    lookup(value, key, site) ?? fail(site, `\`.${key}\`, which the object does not declare,`);

  const readProps = (open: number): Prop[] => {
    const close = closing(open);
    const props: Prop[] = [];
    let j = open + 1;
    while (j < close) {
      const t = at(j);
      if (t?.text === ",") {
        j++;
        continue;
      }
      if (t?.text === "...") {
        const to = expressionEnd(j + 1);
        props.push({ kind: "spread", from: j + 1, to });
        j = to;
        continue;
      }
      const computed = t?.text === "[";
      const key = computed ? undefined : t?.kind === "string" ? t.value : t?.text;
      const after = computed ? closing(j) + 1 : j + 1;
      const next = at(after)?.text;
      if (next === ":") {
        const to = expressionEnd(after + 1);
        props.push({ kind: "property", key, from: after + 1, to });
        j = to;
      } else if ((next === "," || after === close) && t?.kind === "ident") {
        props.push({ kind: "shorthand", key: t.text, at: j });
        j = after;
      } else {
        props.push({ kind: "other", key });
        j = expressionEnd(after);
        while (j < close && at(j)?.text !== ",") j = isOpen(at(j)) ? closing(j) + 1 : j + 1;
      }
    }
    return props;
  };

  const objectAt = (from: number, to: number): Value & { kind: "object" } => {
    const value = evaluate(from, to);
    return value.kind === "object" ? value : fail(from, "a string where an object belongs");
  };

  const mapSpecifiers = (from: number, to: number): string[] =>
    objectAt(from, to).props.flatMap((prop) => {
      if (prop.kind === "spread") return mapSpecifiers(prop.from, prop.to);
      if (prop.kind === "other") return fail(from, "a method in an `expose` map");
      const value = prop.kind === "shorthand" ? evaluate(prop.at, prop.at + 1) : evaluate(prop.from, prop.to);
      return value.kind === "string" ? [value.value] : fail(from, "a module specifier that is not a string");
    });

  const optionSpecifiers = (from: number, to: number): string[] =>
    objectAt(from, to).props.flatMap((prop) => {
      if (prop.kind === "spread") return optionSpecifiers(prop.from, prop.to);
      if (prop.key === undefined || (prop.kind === "other" && prop.key === "expose"))
        return fail(from, "a computed or method member of `mount`'s options");
      if (prop.key !== "expose") return [];
      return prop.kind === "shorthand" ? mapSpecifiers(prop.at, prop.at + 1) : prop.kind === "property" ? mapSpecifiers(prop.from, prop.to) : [];
    });

  const argumentsOf = (open: number): { from: number; to: number }[] => {
    const close = closing(open);
    const args: { from: number; to: number }[] = [];
    let j = open + 1;
    while (j < close) {
      if (at(j)?.text === "...") return fail(j, "a spread argument");
      const to = expressionEnd(j);
      if (to === j) return fail(j, "an argument");
      args.push({ from: j, to });
      j = at(to)?.text === "," ? to + 1 : to;
    }
    return args;
  };

  const isImportMetaUrl = (j: number): boolean =>
    at(j)?.text === "import" && at(j + 1)?.text === "." && at(j + 2)?.text === "meta" && at(j + 3)?.text === "." && at(j + 4)?.text === "url";

  const specifiers: string[] = [];
  const urls: string[] = [];
  const consumed = new Set<number>();

  tokens.forEach((t, j) => {
    if (t.kind === "ident" && t.text === "import" && at(j + 1)?.text === "{") {
      const close = closing(j + 1);
      for (let k = j + 2; k < close; k++)
        if (at(k)?.text === "mount" || at(k)?.text === "bundleModules") {
          if (at(k + 1)?.text === "as") fail(k, `\`${at(k)?.text}\` imported under another name`);
          consumed.add(k);
        }
    }
    if (t.kind === "ident" && (t.text === "mount" || t.text === "bundleModules") && at(j + 1)?.text === "(" && at(j - 1)?.text !== "function") {
      const args = argumentsOf(j + 1);
      const options = t.text === "mount" ? args[2] : args[0];
      if (t.text === "bundleModules" && options === undefined) fail(j, "`bundleModules` with no map");
      if (options !== undefined) specifiers.push(...(t.text === "mount" ? optionSpecifiers : mapSpecifiers)(options.from, options.to));
      consumed.add(j);
    }
    if (t.text === "new" && at(j + 1)?.text === "URL" && at(j + 2)?.text === "(") {
      const [target, base] = argumentsOf(j + 2);
      if (base === undefined || base.to - base.from !== 5 || !isImportMetaUrl(base.from)) return;
      const value = target === undefined ? fail(j, "`new URL` with no path") : evaluate(target.from, target.to);
      urls.push(value.kind === "string" ? value.value : fail(j, "a `new URL` path that is not a string"));
      consumed.add(base.from);
    }
  });

  tokens.forEach((t, j) => {
    const isKey = ["{", ","].includes(at(j - 1)?.text ?? "") && at(j + 1)?.text === ":";
    if (consumed.has(j) || isKey) return;
    if (t.kind === "ident" && (t.text === "mount" || t.text === "bundleModules") && at(j - 1)?.text !== ".")
      fail(j, `\`${t.text}\` used other than as a call`);
    if (t.kind === "ident" && t.text === "mount" && at(j - 1)?.text === "." && at(j + 1)?.text !== "(")
      fail(j, "`.mount` used other than as a call");
    if (isImportMetaUrl(j)) fail(j, "`import.meta.url` used other than as the base of `new URL(<string>, import.meta.url)`");
  });

  return { specifiers, urls };
}
