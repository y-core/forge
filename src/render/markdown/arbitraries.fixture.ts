import fc from "fast-check";

const TOKENS: readonly string[] = [
  "\n",
  "\r\n",
  "\r",
  " ",
  "  ",
  "\t",
  "    ",
  "#",
  "# ",
  ">",
  "> ",
  "- ",
  "* ",
  "1. ",
  "2) ",
  "- [ ] ",
  "---",
  "===",
  "==",
  "```",
  "~~~",
  "$$",
  "$",
  "|",
  "[[",
  "]]",
  "![[",
  "\\",
  "[",
  "]",
  "(",
  ")",
  "!",
  "[!note] ",
  "#tag",
  "due:2026-10-01",
  "📅 ",
  "<div>",
  "&amp;",
  "[^1]",
  "[^1]: ",
  "`",
  "*",
  "_",
  "~~",
  "a",
  "word",
  "\u0000",
  // A lone high surrogate: half of an astral character with no partner.
  "\uD83D",
  "\uFEFF",
  "| a | b |\n|---|---|\n",
];

export const mixedMarkdown: fc.Arbitrary<string> = fc.string({ unit: fc.constantFrom(...TOKENS), maxLength: 120 });

const text: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"),
    fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789 "), maxLength: 12 }),
  )
  .map(([first, rest]) => first + rest);

const unitBlocks: fc.Arbitrary<string[]> = fc.oneof(
  text.map((line) => [`${line}\n`]),
  fc.tuple(fc.integer({ min: 1, max: 6 }), text).map(([depth, line]) => [`${"#".repeat(depth)} ${line}\n`]),
  text.map((line) => [`\`\`\`\n${line}\n\`\`\`\n`]),
  text.map((line) => [`$$\n${line}\n$$\n`]),
  fc.tuple(text, text, text, text).map(([a, b, c, d]) => [`| ${a} | ${b} |\n|---|---|\n| ${c} | ${d} |\n`]),
  fc.tuple(text, text).map(([title, body]) => [`> [!note] ${title}\n> ${body}\n`]),
  fc.constant<string[]>(["---\n"]),
  fc.array(text, { minLength: 1, maxLength: 4 }).map((items) => items.map((item) => `- ${item}\n`)),
);

export interface StructuredMarkdown {
  units: string[];
  md: string;
}

export const structuredMarkdown: fc.Arbitrary<StructuredMarkdown> = fc
  .array(fc.tuple(unitBlocks, fc.integer({ min: 1, max: 3 })), { minLength: 1, maxLength: 12 })
  .chain((groups) =>
    fc.integer({ min: 0, max: 3 }).map((lastBlankLines) => {
      const units = groups.flatMap(([group, blankLines], index) => {
        const trailing = "\n".repeat(index === groups.length - 1 ? lastBlankLines : blankLines);
        return group.map((unit, item) => (item === group.length - 1 ? unit + trailing : unit));
      });
      return { units, md: units.join("") };
    }),
  );

const lineEnding: fc.Arbitrary<string> = fc.constantFrom("\n", "\n", "\r\n", "\r");

const blockFragment: fc.Arbitrary<string> = fc.oneof(
  text.map((a) => `${a}\n`),
  fc.tuple(text, text).map(([a, b]) => `${a}\n${b}\n`),
  fc.tuple(text, fc.constantFrom("===", "---", "-")).map(([a, marker]) => `${a}\n${marker}\n`),
  fc.tuple(fc.integer({ min: 1, max: 6 }), text).map(([depth, a]) => `${"#".repeat(depth)} ${a}\n`),
  fc.tuple(fc.constantFrom("```", "~~~", "````"), text).map(([fence, a]) => `${fence}\n${a}\n${fence}\n`),
  fc.constantFrom("```\n", "~~~\n", "````\n", "```js\n"),
  fc.tuple(text, text).map(([a, b]) => `    ${a}\n\n    ${b}\n`),
  fc.tuple(text, text, text).map(([a, b, c]) => `- ${a}\n\n  ${b}\n- ${c}\n`),
  fc.tuple(text, text).map(([a, b]) => `1. ${a}\n2) ${b}\n`),
  fc.tuple(text, text).map(([a, b]) => `- ${a}\n  - ${b}\n`),
  fc.tuple(text, text).map(([a, b]) => `[^${a.slice(0, 3)}]: ${b}\n\n    ${a}\n`),
  text.map((a) => `[${a}]: /u\n`),
  fc.tuple(text, text).map(([a, b]) => `> ${a}\n${b}\n`),
  fc.tuple(text, text).map(([a, b]) => `- ${a}\n${b}\n`),
  fc.tuple(text, text).map(([a, b]) => `| ${a} | ${b} |\n|---|---|\n`),
  fc.constantFrom("***\n", "\n", "    \n", "\u{feff}a\n"),
);

const blockRun: fc.Arbitrary<string> = fc
  .array(fc.tuple(blockFragment, lineEnding, fc.integer({ min: 0, max: 2 })), { minLength: 1, maxLength: 10 })
  .map((fragments) => fragments.map(([fragment, ending, blank]) => (fragment + "\n".repeat(blank)).replaceAll("\n", ending)).join(""));

/** Block structure that an edit can reshape: fences, setext headings, indented code, loose list items, footnotes and lazy continuation, in any line ending. */
export const blockMarkdown: fc.Arbitrary<string> = fc
  .tuple(fc.boolean(), blockRun)
  .map(([byteOrderMark, source]) => (byteOrderMark ? "\u{feff}" : "") + source);

/** A replacement of `remove` code units at fraction `at` of a source, its text drawn from the block and token generators alike. */
export const markdownEdit: fc.Arbitrary<{ at: number; remove: number; insert: string }> = fc.record({
  at: fc.integer({ min: 0, max: 1024 }).map((step) => step / 1024),
  remove: fc.nat({ max: 40 }),
  insert: fc.oneof(blockRun, mixedMarkdown, fc.constantFrom("", "\n", "\r", "```", "\u{feff}")),
});
