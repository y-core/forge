import { describe, expect, it } from "bun:test";

import { formDigits } from "../../validation/form-digits";
import { v } from "../../validation/validation";
import { applyFormat, INPUT_FORMAT_ATTR, INPUT_FORMAT_SCOPE, stripFormat } from "./input-format-contract";

const CARD = "#### #### #### ####";
const PHONE = "(###) ###-####";
const EXPIRY = "##/##";

/** Every template the idempotency and round-trip loops run over. */
const TEMPLATES: string[] = [CARD, PHONE, EXPIRY, "###-###", "## ## ##", "#"];

/** Every value those loops run over, formatted or not, short or over capacity. */
const VALUES: string[] = [
  "",
  "   ",
  "4",
  "4111",
  "41111",
  "4111111111111111",
  "4111 1111 1111 1111",
  "(555) 123-4567",
  "55512345678901234567",
  "abc",
];

describe("input format contract", () => {
  it("names the scope the SSR stamps and the client registers", () => {
    expect(INPUT_FORMAT_SCOPE).toBe("input-format");
  });

  it("names the attribute carrying the template", () => {
    expect(INPUT_FORMAT_ATTR).toBe("data-format");
  });
});

describe("stripFormat", () => {
  const cases: { name: string; template: string; value: string; expected: string }[] = [
    {
      name: "removes the template's spaces from a grouped card number",
      template: CARD,
      value: "4111 1111 1111 1111",
      expected: "4111111111111111",
    },
    { name: "removes parentheses, a space and a hyphen the template declares", template: PHONE, value: "(555) 123-4567", expected: "5551234567" },
    { name: "removes the slash an expiry template declares", template: EXPIRY, value: "12/26", expected: "1226" },
    { name: "removes whitespace even when the template declares none", template: "######", value: " 55 51 23 ", expected: "555123" },
    { name: "removes a tab and a CRLF pair the template never mentions", template: "######", value: "55\t51\r\n23", expected: "555123" },
    { name: "keeps a character the template does not declare as a literal", template: CARD, value: "4111-1111", expected: "4111-1111" },
    { name: "keeps non-ASCII significant characters", template: "###", value: "٥ab", expected: "٥ab" },
    { name: "passes the empty string through", template: CARD, value: "", expected: "" },
    { name: "collapses a whitespace-only value", template: CARD, value: "   ", expected: "" },
    { name: "collapses a literals-only value", template: PHONE, value: "() -", expected: "" },
    { name: "removes every literal from a slotless template too", template: "--", value: "5-5-5", expected: "555" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(stripFormat(c.template, c.value)).toBe(c.expected);
    });
  }
});

describe("applyFormat", () => {
  const cases: { name: string; template: string; value: string; expected: string }[] = [
    { name: "groups a full card number", template: CARD, value: "4111111111111111", expected: "4111 1111 1111 1111" },
    {
      name: "re-formats an already formatted card number to itself",
      template: CARD,
      value: "4111 1111 1111 1111",
      expected: "4111 1111 1111 1111",
    },
    { name: "normalises an interleaved literal rather than accumulating separators", template: CARD, value: "41 11", expected: "4111" },
    { name: "emits no trailing separator when a group is exactly filled", template: CARD, value: "4111", expected: "4111" },
    { name: "emits the separator only once the next group has a character", template: CARD, value: "41111", expected: "4111 1" },
    { name: "fills a leading literal template", template: PHONE, value: "5551234567", expected: "(555) 123-4567" },
    { name: "emits the leading literal as soon as one character exists", template: PHONE, value: "5", expected: "(5" },
    { name: "emits consecutive literals together", template: PHONE, value: "555", expected: "(555" },
    { name: "fills a template whose literals are consecutive", template: EXPIRY, value: "1226", expected: "12/26" },
    { name: "emits the empty string for an empty value", template: CARD, value: "", expected: "" },
    { name: "emits the empty string for a whitespace-only value rather than a bare skeleton", template: CARD, value: "   ", expected: "" },
    { name: "emits the empty string for a literals-only value", template: PHONE, value: "() -", expected: "" },
    {
      name: "returns the bare significant characters when the value exceeds the slots",
      template: CARD,
      value: "41111111111111119999",
      expected: "41111111111111119999",
    },
    { name: "truncates nothing when an already formatted value exceeds the slots", template: EXPIRY, value: "12/26/99", expected: "122699" },
    { name: "returns the value verbatim when the template has no slot", template: "--", value: "5-5-5", expected: "5-5-5" },
    { name: "returns the value verbatim when the template is empty", template: "", value: "  4111  ", expected: "  4111  " },
    { name: "carries non-ASCII significant characters into the slots", template: "## ##", value: "٥a٥a", expected: "٥a ٥a" },
    { name: "fills a single-slot template", template: "#", value: "7", expected: "7" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(applyFormat(c.template, c.value)).toBe(c.expected);
    });
  }

  for (const template of TEMPLATES) {
    for (const value of VALUES) {
      it(`is idempotent for ${JSON.stringify(value)} under ${JSON.stringify(template)}`, () => {
        const once = applyFormat(template, value);
        expect(applyFormat(template, once)).toBe(once);
      });
    }
  }
});

describe("applyFormat — the wire value a digit schema reads", () => {
  const Card = v.pipe(formDigits(), v.length(16));

  it("lets a digit schema accept the formatted string a form actually posts", () => {
    const result = v.safeParse(Card, applyFormat(CARD, "4111111111111111"));
    expect(result.success).toBe(true);
    expect(result.success && result.output).toBe("4111111111111111");
  });

  for (const value of VALUES) {
    it(`parses ${JSON.stringify(value)} to the same digits formatted or not`, () => {
      const bare = v.safeParse(formDigits(), value);
      const formatted = v.safeParse(formDigits(), applyFormat(CARD, value));
      expect(bare.success && formatted.success && formatted.output).toBe(bare.success ? bare.output : "");
    });
  }
});

describe("applyFormat — characters outside the basic plane", () => {
  // `stripFormat` builds its result by code point (`for...of`) while `applyFormat` used to measure
  // and index it by UTF-16 code unit, so three astral characters against six slots passed the
  // `> slots` bail and were then emitted one code unit at a time, splitting every surrogate pair.
  it("counts an astral character once, and never splits its surrogate pair", () => {
    expect(applyFormat("###-###", "\u{1F600}\u{1F601}\u{1F602}")).toBe("\u{1F600}\u{1F601}\u{1F602}");
  });

  it("bails to the bare significant characters once they outnumber the slots, still unsplit", () => {
    expect(applyFormat("##", "\u{1F600}\u{1F601}\u{1F602}")).toBe("\u{1F600}\u{1F601}\u{1F602}");
  });

  it("earns a literal between astral characters exactly as it does between digits", () => {
    expect(applyFormat("##-##", "\u{1F600}\u{1F601}\u{1F602}")).toBe("\u{1F600}\u{1F601}-\u{1F602}");
  });
});
