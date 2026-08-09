/** jsx-parse.ts — the matchers `validate-jsx.ts` decides on.
 *
 *  Mirrors the `validate-exports.ts` / `barrel-parse.ts` split: `validate-jsx.ts` remains the entry
 *  point and retains every policy decision — which trees are walked, what fails and with what
 *  message — while the scanning lives here, where it is importable and therefore assertable.
 *
 *  Strings in, data out: no disk, no repo root, no path. `validate-jsx.ts` walks the whole of
 *  `src/`, so a `.tsx` fixture written to trip the rule would fail the very gate it exists to test.
 *  A string signature is what keeps that file from having to exist.
 *
 *  Two classes of imprecision are accepted, for different reasons.
 *
 *  A **false positive**: an identifier bound to a locally-built object is flagged, though it cannot
 *  carry a caller's token — the scan is syntactic and resolves no bindings. Two such sites exist,
 *  both in `ui/chrome/navbar.tsx`, where `fattrs` comes from `filterAttrs()` and holds only
 *  `data-filter` and `hidden`. They merge like every other site rather than being suppressed. That
 *  is the deliberate trade: a suppression pragma would cost less to write than the one-line
 *  destructure it excuses, which inverts the gradient this rule exists to create, and it would cost
 *  the property that makes the rule worth having — that zero findings means the migration is
 *  complete, with no second list of licensed exceptions to read alongside it. Neither
 *  `validate-exports.ts` nor `validate-docs.ts` offers per-site suppression either.
 *
 *  A **false negative**: a conditional wrapping the rest object (`{...(cond ? rest : {})}`) reads as
 *  a computed expression and is skipped, though it can carry a token. This one has **zero**
 *  occurrences today, and it is the direction a real defect escapes in, so its absence is pinned by
 *  a fixture rather than merely asserted here.
 */

/** A literal `data-slot` that a later spread on the same element can overwrite. */
export interface SlotClobber {
  /** 1-indexed line of the `data-slot` attribute — the position worth pointing a reader at. */
  line: number;
  /** The element or component tag as written, e.g. `div` or `Menu.Item`. */
  tag: string;
  /** The literal `data-slot` value, e.g. `card-header`. */
  slot: string;
  /** The bare identifier whose spread clobbers it, e.g. `rest`. */
  spread: string;
}

/** Opens a JS identifier, and so also a tag name and a spread argument. */
const IDENT_START = /[A-Za-z_$]/;

/** Continues a bare JS identifier. A spread argument may hold nothing else: a dot, a paren or a
 *  bracket makes the spread a computed expression, which cannot be a caller's untouched props. */
const IDENT_PART = /[A-Za-z0-9_$]/;

/** Continues a tag name, where dots (`Menu.Item`) and hyphens (`my-element`) are legal. */
const TAG_PART = /[A-Za-z0-9_$.-]/;

/** Continues an attribute name, which is hyphenated (`data-slot`) and may be namespaced (`xlink:href`). */
const ATTR_PART = /[A-Za-z0-9_:.-]/;

/** One opening tag under examination. `braces` counts the braced expressions open inside it, so
 *  that only a `>` at depth 0 is read as the tag's own terminator. */
interface TagFrame {
  tag: string;
  braces: number;
  slot: { value: string; line: number } | null;
  reported: boolean;
}

/** Offset of the first character of each line, for resolving an index to a 1-indexed line. */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** The 1-indexed line `index` sits on. */
function lineAt(starts: number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** The index just past the string or template opened at `open`, backslash escapes honoured. */
function skipQuoted(source: string, open: number): number {
  const quote = source[open];
  let i = open + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return source.length;
}

/** The index just past `start`'s run of characters matching `pattern`. */
function skipRun(source: string, start: number, pattern: RegExp): number {
  let i = start;
  while (i < source.length && pattern.test(source[i] ?? "")) i++;
  return i;
}

/** The index of the first non-whitespace character at or after `start`. */
function skipSpace(source: string, start: number): number {
  let i = start;
  while (i < source.length && /\s/.test(source[i] ?? "")) i++;
  return i;
}

/** The spread of a bare identifier opened at `open`, or `null` for anything computed. */
function matchBareSpread(source: string, open: number): { name: string; end: number } | null {
  let i = skipSpace(source, open + 1);
  if (source.slice(i, i + 3) !== "...") return null;
  i = skipSpace(source, i + 3);
  if (!IDENT_START.test(source[i] ?? "")) return null;
  const nameEnd = skipRun(source, i + 1, IDENT_PART);
  const name = source.slice(i, nameEnd);
  const close = skipSpace(source, nameEnd);
  if (source[close] !== "}") return null;
  return { name, end: close + 1 };
}

/** A literal `data-slot="token"` whose name run ends at `nameEnd`, or `null` when braced. */
function matchSlotLiteral(source: string, nameEnd: number): { value: string; end: number } | null {
  let i = skipSpace(source, nameEnd);
  if (source[i] !== "=") return null;
  i = skipSpace(source, i + 1);
  const quote = source[i];
  if (quote !== '"' && quote !== "'") return null;
  const close = source.indexOf(quote, i + 1);
  if (close === -1) return null;
  return { value: source.slice(i + 1, close), end: close + 1 };
}

/**
 * Every element in `source` whose literal `data-slot` a later spread can silently overwrite.
 *
 * A component that writes `data-slot='card-header'` and then spreads a caller's rest props hands
 * the caller a way to erase the token — last attribute wins, and `{...rest}` sitting after the
 * literal is exactly that. The token is not decoration: forge's own styling and composition keys on
 * `[data-slot~="…"]`, so losing it unmakes the element without any error being raised. The migrated
 * shape puts the token in braces, where the component merges rather than surrenders it, which is why
 * `data-slot={…}` is exempt by construction.
 *
 * Only a spread of a bare identifier counts. `{...stateAttrs({ open })}` and `{...(open ? x : {})}`
 * are built at the call site out of values the component controls, so no caller token can be hiding
 * in them. A spread standing *before* the literal is likewise fine — the literal wins there.
 *
 * The scan is a character machine rather than a regular expression because both hazards it must
 * survive are ones a regular expression cannot see. Prose in a doc comment quotes selectors like
 * `[data-slot="…"]`, and an attribute value can hold a `>` inside a string inside a braced
 * expression — a scanner that took that `>` for the end of the tag would misread everything after
 * it. One finding per element: a second clobbering spread on the same tag says nothing new.
 */
export function findSlotClobbers(source: string): SlotClobber[] {
  const found: SlotClobber[] = [];
  const starts = lineStarts(source);
  const stack: TagFrame[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";
    const frame = stack[stack.length - 1];

    if (ch === "/" && next === "/") {
      const nl = source.indexOf("\n", i + 2);
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuoted(source, i);
      continue;
    }

    // Attribute region of the innermost tag: its own terminators, its attributes, its spreads.
    if (frame && frame.braces === 0) {
      if (ch === "/" && next === ">") {
        stack.pop();
        i += 2;
        continue;
      }
      if (ch === ">") {
        stack.pop();
        i++;
        continue;
      }
      if (ch === "{") {
        const spread = matchBareSpread(source, i);
        if (spread) {
          if (frame.slot && !frame.reported) {
            frame.reported = true;
            found.push({ line: frame.slot.line, tag: frame.tag, slot: frame.slot.value, spread: spread.name });
          }
          i = spread.end;
          continue;
        }
        frame.braces++;
        i++;
        continue;
      }
      if (IDENT_START.test(ch)) {
        const nameEnd = skipRun(source, i + 1, ATTR_PART);
        if (source.slice(i, nameEnd) === "data-slot") {
          const literal = matchSlotLiteral(source, nameEnd);
          if (literal) {
            frame.slot ??= { value: literal.value, line: lineAt(starts, i) };
            i = literal.end;
            continue;
          }
        }
        i = nameEnd;
        continue;
      }
    }

    // Inside a braced expression, whether an attribute's or the module's own code.
    if (frame && frame.braces > 0) {
      if (ch === "{") {
        frame.braces++;
        i++;
        continue;
      }
      if (ch === "}") {
        frame.braces--;
        i++;
        continue;
      }
    }

    // A nested element inside a braced attribute is its own site: pushing rather than recursing
    // keeps the parent's attributes out of the child's tally and the child's out of the parent's.
    if (ch === "<" && (!frame || frame.braces > 0) && IDENT_START.test(next)) {
      const nameEnd = skipRun(source, i + 2, TAG_PART);
      stack.push({ tag: source.slice(i + 1, nameEnd), braces: 0, slot: null, reported: false });
      i = nameEnd;
      continue;
    }

    i++;
  }

  return found;
}
