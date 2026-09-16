import { describe, expect, it } from "bun:test";

import { excerptOf, headingTrail } from "./excerpt";

const EMPTY = { title: "One", gloss: "", rules: "", body: "" };

describe("headingTrail()", () => {
  it("drops the addressing slug from every segment and keeps every title", () => {
    expect(headingTrail("~core-components-apis. Core Components & APIs › ~requestlogger-options. requestLogger(options)")).toBe(
      "Core Components & APIs › requestLogger(options)",
    );
  });

  // Stripping the whole segment would render `~http. http › ~exports. Exports` and its `~app.`
  // sibling as two identical `Exports` lines, and the trail carries the raw slug rather than the
  // uniquified one, so nothing downstream would tell them apart either.
  it("keeps the parent's title, which is the only thing separating two `Exports` trails", () => {
    expect(headingTrail("~http. http › ~exports. Exports")).toBe("http › Exports");
    expect(headingTrail("~app. app › ~exports. Exports")).toBe("app › Exports");
  });

  it("leaves a numbered trail alone, slug stripping being a `~heading` corpus's problem", () => {
    expect(headingTrail("5. Comment Budget Rule › 5c. Where Rationale Belongs")).toBe("5. Comment Budget Rule › 5c. Where Rationale Belongs");
  });
});

describe("excerptOf()", () => {
  it("leads with the gloss, which is the corpus's own summary of the section", () => {
    expect(excerptOf({ ...EMPTY, gloss: "the comment budget", rules: "Never exceed the comment budget", body: "Prose." }, "comment")).toBe(
      "the comment budget",
    );
  });

  it("falls to the rule clause, the highest-weighted column and one nothing rendered before", () => {
    expect(excerptOf({ ...EMPTY, rules: "Keys not declared in `entries` are stripped", body: "Prose about keys." }, "entries")).toBe(
      "Keys not declared in `entries` are stripped",
    );
  });

  // Every value under five words in `warden probe`'s `## rules` block is a bag of emphasised words
  // rather than a clause, because `ruleClauses` joins each `**bold**` run with a space and filters
  // nothing. Rejecting one costs nothing: the prose arm is behind it.
  it("refuses a rules value too short to be a clause, and cuts the prose instead", () => {
    expect(excerptOf({ ...EMPTY, rules: "Returns Throws", body: "The accessor returns a header value." }, "accessor")).toBe(
      "The accessor returns a header value",
    );
  });

  it("returns the title rather than nothing when the section is a code fence and a rule fragment", () => {
    expect(excerptOf({ ...EMPTY, title: "Wrangler Config", rules: "both", body: "```toml\nname = 'worker'\n```" }, "wrangler")).toBe(
      "Wrangler Config",
    );
  });

  it("anchors on a stem, because the tokenizer stems and the reader types the inflection", () => {
    const body = `${"padding word ".repeat(20)}A handler throws rather than returning a Result. ${"tail word ".repeat(20)}`;

    expect(excerptOf({ ...EMPTY, body }, "returning")).toBe(
      `… word A handler throws rather than returning a Result ${"tail word ".repeat(10)}tail …`,
    );
  });

  it("anchors on a bridge target, which never appears in what the reader typed", () => {
    const body = `${"padding word ".repeat(20)}A honeypot field is never rendered visibly. ${"tail word ".repeat(20)}`;
    const excerpt = excerptOf({ ...EMPTY, body }, "bot field", new Map([["bot", ["honeypot"]]]));

    expect(excerpt).toBe(`… word padding word padding word A honeypot field is never rendered visibly ${"tail word ".repeat(8)}tail …`);
  });

  it("elides on whichever side it cut, so a reader can see the excerpt is not the section", () => {
    const body = `${"padding word ".repeat(20)}The anchor sits here. ${"tail word ".repeat(20)}`;
    expect(excerptOf({ ...EMPTY, body }, "anchor")).toBe(`… word padding word padding word The anchor sits here ${"tail word ".repeat(10)}tail …`);
  });

  it("cuts from the fence-stripped prose, never from text the index has not seen", () => {
    const body = "```ts\nconst websocket = upgrade(request);\n```\n\nThe router has no upgrade path.";

    // Anchoring on `websocket` would explain a match that did not happen: `searchBody` strips the
    // fence before indexing, so nothing in the index ever carried that word.
    expect(excerptOf({ ...EMPTY, body }, "websocket")).toBe("The router has no upgrade path");
  });

  // Both surfaces separate one hit from the next with a blank line, so an excerpt carrying a
  // paragraph break renders as two hits and a caller counting blocks counts wrong.
  it("stays one line, `proseOf` collapsing spaces and tabs but keeping every newline", () => {
    expect(excerptOf({ ...EMPTY, body: "The widget must be allowed by your\n\nContent-Security-Policy header." }, "widget")).toBe(
      "The widget must be allowed by your Content-Security-Policy header",
    );
  });

  it("never returns an empty string, whatever the section carries", () => {
    expect(excerptOf({ title: "Exports", gloss: "", rules: "", body: "" }, "exports")).toBe("Exports");
    expect(excerptOf({ title: "Exports", gloss: "", rules: "", body: "" }, "")).toBe("Exports");
  });
});
