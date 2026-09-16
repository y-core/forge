import { describe, expect, it } from "bun:test";

import { renderHit } from "./render";
import type { Hit } from "./search";

const HIT: Hit = {
  id: "canon:CODE_RULES.md#5c",
  corpus: "canon",
  tree: "libs",
  path: "CODE_RULES.md",
  section: "5c",
  title: "Where Rationale Belongs Instead",
  headingPath: "5. Comment Budget Rule › 5c. Where Rationale Belongs Instead",
  gloss: "route rationale to its single home",
  score: 12.3456,
  coverage: 0.87,
};

describe("renderHit()", () => {
  it("renders the id, the coverage, the corpus in words, the trail and the line under it", () => {
    expect(renderHit(HIT)).toBe(
      "canon:CODE_RULES.md#5c  (0.87, fleet canon)\n  5. Comment Budget Rule › 5c. Where Rationale Belongs Instead\n  route rationale to its single home",
    );
  });

  it("adds the BM25 score only when asked, and names it rather than printing a bare number", () => {
    expect(renderHit(HIT, { score: true }).split("\n")[0]).toBe("canon:CODE_RULES.md#5c  (0.87, bm25 12.3456, fleet canon)");
  });

  // The whole reason `search` carries one: a hit whose corpus wrote no Quick Reference line is
  // otherwise an id and a heading trail, and 37% of the searchable corpus is in that state.
  it("prefers the excerpt over the gloss, because the excerpt already resolved that precedence", () => {
    const rendered = renderHit({ ...HIT, gloss: "", excerpt: "Keys not declared in `entries` are stripped" });

    expect(rendered.split("\n")[2]).toBe("  Keys not declared in `entries` are stripped");
  });

  it("emits two lines rather than a blank third when the hit carries neither", () => {
    expect(renderHit({ ...HIT, gloss: "" })).toBe(
      "canon:CODE_RULES.md#5c  (0.87, fleet canon)\n  5. Comment Budget Rule › 5c. Where Rationale Belongs Instead",
    );
  });

  it("strips the addressing slug from a `~heading` corpus's trail", () => {
    const rendered = renderHit({
      ...HIT,
      corpus: "project",
      headingPath: "~core-components-apis. Core Components & APIs › ~requestlogger-options. requestLogger(options)",
    });

    expect(rendered.split("\n")[1]).toBe("  Core Components & APIs › requestLogger(options)");
  });

  // A repository specialises the canon under the same filename and section numbers, so the prefix
  // is all that distinguishes two otherwise identical hits.
  it("names the corpus even for the repository's own documents, never only the canon's", () => {
    expect(renderHit({ ...HIT, corpus: "project" }).split("\n")[0]).toBe("canon:CODE_RULES.md#5c  (0.87, this repository)");
  });
});
