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
