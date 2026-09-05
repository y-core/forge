import { balancedSpan, blankSourceComments, lineAt } from "./source-scan";

/** A `<!-- rule:… -->` marker: the id as written, and where it was written. */
export interface RuleMarker {
  /** 1-indexed line the marker sits on. */
  line: number;
  /** The id exactly as written, including a malformed one. */
  id: string;
}

const RULE_ID_GRAMMAR = /^forge-ui-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether `id` satisfies the rule-id grammar. */
export function isValidRuleId(id: string): boolean {
  return RULE_ID_GRAMMAR.test(id);
}

/** Every `<!-- rule:… -->` marker in a corpus document. */
export function findRuleMarkers(source: string): RuleMarker[] {
  const found: RuleMarker[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const match of line.matchAll(/<!--\s*rule:\s*([^\s>]*?)\s*-->/g)) {
      found.push({ line: i + 1, id: match[1] ?? "" });
    }
  }
  return found;
}

/** Every rule id cited in prose — a backticked bare id. */
export function findRuleCitations(source: string): RuleMarker[] {
  const found: RuleMarker[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const match of line.matchAll(/`(forge-ui-[A-Za-z0-9-]+)`/g)) {
      found.push({ line: i + 1, id: match[1] ?? "" });
    }
  }
  return found;
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

/** Every named-import statement in `source` that pulls from `packageName`. */
export function findBarrelImports(source: string, packageName: string): BarrelImport[] {
  const re = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*["'](${packageName.replace("/", "\\/")}\\/[^"']+)["']`, "gs");
  const found: BarrelImport[] = [];

  for (const match of source.matchAll(re)) {
    const body = match[1];
    const specifier = match[2];
    if (body === undefined || specifier === undefined) continue;

    const symbols = body
      .split(",")
      .map((part) => {
        let trimmed = part.trim();
        if (trimmed.startsWith("type ")) trimmed = trimmed.slice(5).trim();
        const asIdx = trimmed.indexOf(" as ");
        return asIdx >= 0 ? trimmed.slice(0, asIdx).trim() : trimmed;
      })
      .filter((name) => name.length > 0);
    if (symbols.length === 0) continue;

    found.push({ line: lineAt(source, match.index), subpath: `.${specifier.slice(packageName.length)}`, symbols });
  }
  return found;
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

/** Every well-formed `--foo` token in a corpus document, plus every `--foo-*` family citation. */
export function findCustomPropertyCitations(source: string): CustomPropertyCitation[] {
  const found: CustomPropertyCitation[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const remainder = line.replace(/(?<![\w-])(--[a-z0-9]+(?:-[a-z0-9]+)*)-\*/g, (match, prefix: string) => {
      found.push({ line: i + 1, property: prefix, family: true });
      return " ".repeat(match.length);
    });
    for (const match of remainder.matchAll(/(?<![\w-])--[a-z0-9]+(?:-[a-z0-9]+)*(?![\w])/g)) {
      found.push({ line: i + 1, property: match[0], family: false });
    }
  }
  return found;
}

/** Every custom property declared by a stylesheet — the left side of a `--foo: …` declaration. */
export function parseDeclaredCustomProperties(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of css.matchAll(/(--[a-z0-9]+(?:-[a-z0-9]+)*)\s*:/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

/** One class-shaped string literal and the line it starts on. */
export interface ClassLiteral {
  /** 1-indexed line the literal's opening quote sits on. */
  line: number;
  /** The literal's contents, quotes stripped. */
  text: string;
}

const CLASS_POSITION_GLOBAL = /\bclass(?:Name)?\s*[=:]\s*|\bcn\(|\bcva\(/g;

const ANCHORED_QUOTED = /^(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/;

/** Every literal one class position contributes, and the source ranges reading it consumed. */
interface ClassGroup {
  literals: ClassLiteral[];
  /** Half-open ranges an enclosing span already read, with each `${…}` interior left out of them. */
  consumed: [number, number][];
  /** Positions the span was abandoned at because a literal inside it never closes. */
  skipped: SkippedClassPosition[];
}

/** Reads every string and template literal in `[start, end)` as class text, one literal per quoted
 *  string and one per interpolation-delimited template chunk — the unit the formatter sorts. */
function harvestSpan(scanned: string, start: number, end: number, lineOf: (index: number) => number): ClassGroup {
  const literals: ClassLiteral[] = [];
  const consumed: [number, number][] = [];
  const skipped: SkippedClassPosition[] = [];
  let cursor = start;
  let mergeable = false;
  let lastEnd = -1;

  const emit = (from: number, to: number): void => {
    const text = scanned.slice(from, to);
    if (text.trim() === "") {
      mergeable = false;
      lastEnd = to;
      return;
    }
    const previous = literals.at(-1);
    // `"a " + "b"` is one class string wrapped for line length, so the pair is judged joined:
    // a conflict spanning the `+` is as dead as one inside a single literal.
    if (previous !== undefined && mergeable && /^\s*\+\s*$/.test(scanned.slice(lastEnd + 1, from - 1))) {
      literals[literals.length - 1] = { line: previous.line, text: previous.text + text };
    } else {
      literals.push({ line: lineOf(from), text });
    }
    mergeable = true;
    lastEnd = to;
  };

  const abandon = (at: number): void => {
    const lineEnd = scanned.indexOf("\n", at);
    skipped.push({ line: lineOf(at), text: scanned.slice(at, lineEnd === -1 || lineEnd > end ? end : lineEnd) });
  };

  for (let i = start; i < end; i++) {
    const char = scanned[i];
    if (char !== "'" && char !== '"' && char !== "`") continue;

    if (char !== "`") {
      let close = i + 1;
      for (; close < end; close++) {
        if (scanned[close] === "\\") close++;
        else if (scanned[close] === char) break;
      }
      if (close >= end) {
        abandon(i);
        break;
      }
      emit(i + 1, close);
      i = close;
      continue;
    }

    let chunk = i + 1;
    let j = chunk;
    for (; j < end; j++) {
      if (scanned[j] === "\\") {
        j++;
        continue;
      }
      if (scanned[j] === "`") break;
      if (scanned[j] !== "$" || scanned[j + 1] !== "{") continue;
      const close = balancedSpan(scanned, j + 1);
      if (close === -1) break;
      emit(chunk, j);
      consumed.push([cursor, j + 2]);
      cursor = close;
      j = close;
      chunk = close + 1;
    }
    if (j >= end) {
      abandon(i);
      break;
    }
    emit(chunk, j);
    i = j;
  }

  consumed.push([cursor, end]);
  return { literals, consumed, skipped };
}

/** A class position the scan dropped because its span never closes. */
export interface SkippedClassPosition {
  /** 1-indexed line the position starts on. */
  line: number;
  /** The position as written: up to its opening bracket, or the line the unclosed literal opens on. */
  text: string;
}

/** Every class position in `source`, split into the ones read and the ones dropped unread. */
interface ClassScan {
  groups: ClassGroup[];
  skipped: SkippedClassPosition[];
}

/** Every class position in `source` with the literals it contributes, `//`-commented ones excluded. */
function scanClassGroups(source: string): ClassScan {
  const scanned = blankSourceComments(source);
  const lineOf = (index: number): number => lineAt(scanned, index);
  const groups: ClassGroup[] = [];
  const skipped: SkippedClassPosition[] = [];
  const consumed: [number, number][] = [];

  for (const match of scanned.matchAll(CLASS_POSITION_GLOBAL)) {
    if (consumed.some(([from, to]) => match.index >= from && match.index < to)) continue;
    const after = match.index + match[0].length;

    // A call takes everything up to its own closing paren, which is what reaches a wrapped argument
    // list and a `cva` variant map; an unbalanced span is skipped rather than guessed at.
    const open = match[0].endsWith("(") ? after - 1 : scanned[after] === "{" ? after : -1;
    if (open !== -1) {
      const close = balancedSpan(scanned, open);
      if (close === -1) {
        skipped.push({ line: lineOf(match.index), text: scanned.slice(match.index, open + 1) });
        continue;
      }
      const group = harvestSpan(scanned, open + 1, close, lineOf);
      consumed.push(...group.consumed);
      skipped.push(...group.skipped);
      groups.push(group);
      continue;
    }

    const quoted = ANCHORED_QUOTED.exec(scanned.slice(after));
    if (quoted !== null)
      groups.push({ literals: [{ line: lineOf(after), text: quoted[1] ?? quoted[2] ?? quoted[3] ?? "" }], consumed: [], skipped: [] });
  }
  return { groups, skipped };
}

/** Every string literal in a class position: a `class`/`className` attribute, or an argument to `cn`/`cva`. */
export function findClassLiterals(source: string): ClassLiteral[] {
  return scanClassGroups(source).groups.flatMap((group) => group.literals);
}

/** Every class position dropped unread, so a span the scan cannot close is reportable rather than silent. */
export function findSkippedClassPositions(source: string): SkippedClassPosition[] {
  return scanClassGroups(source).skipped;
}
