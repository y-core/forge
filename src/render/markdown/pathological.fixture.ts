/** Where a pathological shape was taken from. */
export type ShapeOrigin = "cmark" | "cmark-gfm" | "gfm-autolink" | "dialect";

/** An input family that a quadratic parser takes super-linear time on, generated from a repeat count. */
export interface PathologicalShape {
  readonly name: string;
  readonly origin: ShapeOrigin;
  readonly generate: (count: number) => string;
}

function repeated(name: string, origin: ShapeOrigin, unit: string): PathologicalShape {
  return { name, origin, generate: (count) => unit.repeat(count) };
}

function cmarkBadHash(key: string): boolean {
  let hash = 0;
  for (const char of key) hash = (char.charCodeAt(0) + ((hash << 6) >>> 0) + ((hash << 16) >>> 0) - hash) >>> 0;
  return hash % 16 === 0;
}

function referenceCollisions(count: number): string {
  const keys: string[] = [];
  for (let index = 0; keys.length <= count; index++) if (cmarkBadHash(`x${index}`)) keys.push(`x${index}`);
  const [bad, ...rest] = keys;
  return rest.map((key) => `[${key}]: /url\n\n[${bad}]\n\n`).join("");
}

/** cmark's `test/pathological_tests.py` set, each scaled by its repeat count. */
export const CMARK_SHAPES: readonly PathologicalShape[] = [
  { name: "nested strong emph", origin: "cmark", generate: (n) => "*a **a ".repeat(n) + "b" + " a** a*".repeat(n) },
  repeated("many emph closers with no openers", "cmark", "a_ "),
  repeated("many emph openers with no closers", "cmark", "_a "),
  repeated("many link closers with no openers", "cmark", "a]"),
  repeated("many link openers with no closers", "cmark", "[a"),
  repeated("mismatched openers and closers", "cmark", "*a_ "),
  { name: "issue #389", origin: "cmark", generate: (n) => "*a ".repeat(n) + "_a*_ ".repeat(n) },
  { name: "openers and closers multiple of 3", origin: "cmark", generate: (n) => "a**b" + "c* ".repeat(n) },
  repeated("link openers and emph closers", "cmark", "[ a_"),
  repeated("pattern [ (]( repeated", "cmark", "[ (]("),
  repeated("pattern ![[]() repeated", "cmark", "![[]()"),
  repeated("hard link/emph case", "cmark", "**x [a*b**c*](d)\n"),
  { name: "nested brackets", origin: "cmark", generate: (n) => "[".repeat(n) + "a" + "]".repeat(n) },
  { name: "nested block quotes", origin: "cmark", generate: (n) => "> ".repeat(n) + "a" },
  { name: "deeply nested lists", origin: "cmark", generate: (n) => Array.from({ length: n }, (_, x) => "  ".repeat(x) + "* a\n").join("") },
  repeated("U+0000 in input", "cmark", "abc\u0000de\u0000"),
  { name: "backticks", origin: "cmark", generate: (n) => Array.from({ length: n }, (_, x) => "e" + "`".repeat(x + 1)).join("") },
  repeated("unclosed links A", "cmark", "[a](<b"),
  repeated("unclosed links B", "cmark", "[a](b"),
  { name: "unclosed <!--", origin: "cmark", generate: (n) => "</" + "<!--".repeat(n) },
  { name: "empty lines in deeply nested lists", origin: "cmark", generate: (n) => "- ".repeat(n) + "x" + "\n".repeat(n) },
  { name: "empty lines in deeply nested lists in blockquote", origin: "cmark", generate: (n) => "> " + "- ".repeat(n) + "x\n" + ">\n".repeat(n) },
  { name: "emph in deep blockquote", origin: "cmark", generate: (n) => ">".repeat(n) + "a*".repeat(n) },
  { name: "reference collisions", origin: "cmark", generate: referenceCollisions },
  { name: "nested inlines", origin: "cmark", generate: (n) => "*".repeat(n) + "a" + "*".repeat(n) },
];

/** cmark-gfm's table shape from its `test/pathological_tests.py`. */
export const GFM_TABLE_SHAPES: readonly PathologicalShape[] = [repeated("tables", "cmark-gfm", "aaa\rbbb\n-\v\n")];

/** Autolink-literal inputs that make a scanner restart, rescan or trim per character. */
export const GFM_AUTOLINK_SHAPES: readonly PathologicalShape[] = [
  repeated("www prefixes", "gfm-autolink", "www."),
  repeated("failed www domains behind underscores", "gfm-autolink", "_www."),
  { name: "literals under an unclosed bracket", origin: "gfm-autolink", generate: (n) => "[ " + "a@b.co ".repeat(n) },
  { name: "www starts inside a bracketed URL", origin: "gfm-autolink", generate: (n) => "[https://x.com/" + "(www.a".repeat(n) + "]b" },
  { name: "bracketed URLs holding a construct", origin: "gfm-autolink", generate: (n) => "[ " + "https://a.com/*b ".repeat(n) },
  repeated("http prefixes", "gfm-autolink", "http://"),
  repeated("email at signs", "gfm-autolink", "a@"),
  repeated("email dotted labels", "gfm-autolink", "x@y."),
  { name: "trailing closing parens", origin: "gfm-autolink", generate: (n) => "www.x" + ")".repeat(n) },
  { name: "balanced parens", origin: "gfm-autolink", generate: (n) => "https://x" + "(".repeat(n) + ")".repeat(n) },
  { name: "trailing entity-like runs", origin: "gfm-autolink", generate: (n) => "www.a" + "&b;".repeat(n) },
  { name: "underscores in the domain", origin: "gfm-autolink", generate: (n) => "www." + "a_".repeat(n) + "b" },
];

/** The dialect page shapes measured as quadratic in the micromark pipeline. */
export const DIALECT_SHAPES: readonly PathologicalShape[] = [
  repeated("quotes", "dialect", "> q\n\n"),
  repeated("callouts", "dialect", "> [!note] Callout\n> body line\n\n"),
  { name: "callout children", origin: "dialect", generate: (count) => "> [!note] T\n" + "> a\n>\n".repeat(count) },
  repeated("tight list", "dialect", "- a\n"),
  repeated("loose list", "dialect", "- a\n\n"),
  repeated("nested list", "dialect", "- a\n  - b\n"),
  repeated("task list", "dialect", "- [ ] t due:2026-10-01\n"),
  repeated(
    "mixed",
    "dialect",
    "## H\n\nText [[0190f0e0-0000-7000-8000-000000000001|l]] #t ==h== **b**.\n\n- [ ] t due:2026-10-01\n\n> [!note] C\n> b\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nx\n```\n\n",
  ),
];

/** Every pathological shape the engine is held to. */
export const PATHOLOGICAL_SHAPES: readonly PathologicalShape[] = [...CMARK_SHAPES, ...GFM_TABLE_SHAPES, ...GFM_AUTOLINK_SHAPES, ...DIALECT_SHAPES];

/** Generates the longest input of a shape whose length is at most `bytes` UTF-16 code units. */
export function atSize(shape: PathologicalShape, bytes: number): string {
  let high = 1;
  while (shape.generate(high).length <= bytes) high *= 2;
  let low = Math.floor(high / 2);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (shape.generate(middle).length <= bytes) low = middle;
    else high = middle;
  }
  return shape.generate(low);
}
