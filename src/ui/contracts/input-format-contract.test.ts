import { describe, expect, it } from "bun:test";

import { formDigits } from "../../validation/form-digits";
import { v } from "../../validation/validation";
import { applyFormat, INPUT_FORMAT_ATTR, INPUT_FORMAT_SCOPE, stripFormat } from "./input-format-contract";

const CARD = "#### #### #### ####";
const PHONE = "(###) ###-####";
const EXPIRY = "##/##";
const DIALLED = "+1 (###) ###-####";
const TOLL_FREE = "1-###-###-####";

const TEMPLATES: string[] = [CARD, PHONE, EXPIRY, "###-###", "## ## ##", "#", DIALLED, TOLL_FREE, "1-#-#"];

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
  "+1 (415) 555-1212",
  "1-800-555-1212",
  "14155551212",
  "1-1-1-x",
];

const slotsOf = (template: string): number => [...template].filter((char) => char === "#").length;

describe("input format contract", () => {
  it("names the scope the SSR stamps and the client registers", () => {
    expect(INPUT_FORMAT_SCOPE).toBe("input-format");
  });

  it("names the attribute carrying the template", () => {
    expect(INPUT_FORMAT_ATTR).toBe("data-format");
  });
});

describe("a template with a leading digit literal", () => {
  it("formats a bare national number under the dialled prefix", () => {
    expect(applyFormat(DIALLED, "4155551212")).toBe("+1 (415) 555-1212");
  });

  it("strips the dialled prefix back to the national number", () => {
    expect(stripFormat(DIALLED, "+1 (415) 555-1212")).toBe("4155551212");
  });

  it("formats a bare toll-free number under its leading 1-", () => {
    expect(applyFormat(TOLL_FREE, "8005551212")).toBe("1-800-555-1212");
  });

  it("round-trips a toll-free number through format and strip", () => {
    expect(stripFormat(TOLL_FREE, applyFormat(TOLL_FREE, "8005551212"))).toBe("8005551212");
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
    { name: "keeps a literal that arrives where the template places a slot", template: PHONE, value: "() -", expected: ")-" },
    { name: "collapses the template's own literals typed in place", template: PHONE, value: "( ", expected: "" },
    { name: "strips nothing a slotless template has no place for", template: "--", value: "5-5-5", expected: "5-5-5" },
    { name: "keeps a bare national number under a dialled prefix", template: DIALLED, value: "4155551212", expected: "4155551212" },
    { name: "drops a leading 1 typed without the plus", template: DIALLED, value: "14155551212", expected: "4155551212" },
    { name: "drops a leading +1 typed without separators", template: DIALLED, value: "+14155551212", expected: "4155551212" },
    { name: "drops a prefix typed without its plus but with the grouping", template: DIALLED, value: "1 (415) 555-1212", expected: "4155551212" },
    { name: "drops the grouping when the prefix is absent", template: DIALLED, value: "(415) 555-1212", expected: "4155551212" },
    { name: "strips a partial value that has reached the first slot", template: DIALLED, value: "+1 (4", expected: "4" },
    { name: "strips a partial value typed without the prefix", template: DIALLED, value: "(41", expected: "41" },
    { name: "drops the leading 1 of a toll-free number typed bare", template: TOLL_FREE, value: "18005551212", expected: "8005551212" },
    { name: "drops the grouping of a toll-free number typed without its 1-", template: TOLL_FREE, value: "800-555-1212", expected: "8005551212" },
    { name: "strips a partial toll-free value past its prefix", template: TOLL_FREE, value: "1-8", expected: "8" },
    { name: "keeps a digit equal to a literal when it arrives at a slot", template: TOLL_FREE, value: "8005551212", expected: "8005551212" },
    { name: "keeps a # typed into a slot", template: "###", value: "1#2", expected: "1#2" },
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
    { name: "keeps an out-of-place literal as a significant character", template: PHONE, value: "() -", expected: "()-" },
    { name: "emits the empty string for the template's own literals typed in place", template: PHONE, value: "( ", expected: "" },
    {
      name: "returns the value unchanged when it exceeds the slots",
      template: CARD,
      value: "41111111111111119999",
      expected: "41111111111111119999",
    },
    { name: "leaves an already formatted value as typed when it exceeds the slots", template: EXPIRY, value: "12/26/99", expected: "12/26/99" },
    { name: "leaves an over-capacity value as typed", template: CARD, value: "4111 1111 1111 1111 9999", expected: "4111 1111 1111 1111 9999" },
    {
      name: "leaves a value as typed once a literal-equal character overflows the slots",
      template: "1-#-#",
      value: "1-1-1-x",
      expected: "1-1-1-x",
    },
    { name: "re-formats a dialled number to itself", template: DIALLED, value: "+1 (415) 555-1212", expected: "+1 (415) 555-1212" },
    { name: "formats a number typed with its leading 1 as the prefix", template: DIALLED, value: "14155551212", expected: "+1 (415) 555-1212" },
    { name: "emits the prefix and the open group for a partial number", template: DIALLED, value: "415", expected: "+1 (415" },
    { name: "formats a toll-free number typed with its leading 1", template: TOLL_FREE, value: "18005551212", expected: "1-800-555-1212" },
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

  for (const template of TEMPLATES) {
    for (const value of VALUES.filter((typed) => [...stripFormat(template, typed)].length <= slotsOf(template))) {
      it(`strips ${JSON.stringify(value)} to the same characters before and after formatting under ${JSON.stringify(template)}`, () => {
        expect(stripFormat(template, applyFormat(template, value))).toBe(stripFormat(template, value));
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

  it("posts the dialled prefix's digit along with the national number", () => {
    const result = v.safeParse(formDigits(), applyFormat(DIALLED, "4155551212"));
    expect(result.success && result.output).toBe("14155551212");
  });

  it("strips the posted dialled value back to the national number", () => {
    expect(stripFormat(DIALLED, applyFormat(DIALLED, "4155551212"))).toBe("4155551212");
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
  it("counts an astral character once, and never splits its surrogate pair", () => {
    expect(applyFormat("###-###", "\u{1F600}\u{1F601}\u{1F602}")).toBe("\u{1F600}\u{1F601}\u{1F602}");
  });

  it("leaves the value unchanged once its characters outnumber the slots, still unsplit", () => {
    expect(applyFormat("##", "\u{1F600}\u{1F601}\u{1F602}")).toBe("\u{1F600}\u{1F601}\u{1F602}");
  });

  it("earns a literal between astral characters exactly as it does between digits", () => {
    expect(applyFormat("##-##", "\u{1F600}\u{1F601}\u{1F602}")).toBe("\u{1F600}\u{1F601}-\u{1F602}");
  });
});
