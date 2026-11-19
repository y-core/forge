import { describe, expect, it } from "bun:test";

import {
  spokenSqlTokens,
  splitSqlAtDepthZero,
  sqlCheckNullRefusals,
  sqlColumnHasNonNullDefault,
  sqlColumnNullRefusals,
  sqlColumnRefusesOwnNull,
} from "./nullability";

describe("sqlColumnNullRefusals() and sqlColumnHasNonNullDefault()", () => {
  const cases: { definition: string; refusals: string[]; defaulted: boolean }[] = [
    { definition: "x TEXT", refusals: [], defaulted: false },
    { definition: "x TEXT NOT NULL", refusals: ["x"], defaulted: false },
    { definition: "x INTEGER PRIMARY KEY", refusals: ["x"], defaulted: false },
    { definition: `"x" TEXT NOT NULL DEFAULT ''`, refusals: ["x"], defaulted: true },
    { definition: "x TEXT DEFAULT (CASE WHEN 1 NOT NULL THEN 'a' END)", refusals: [], defaulted: true },
    { definition: "x INTEGER AS (y NOT NULL)", refusals: [], defaulted: false },
    { definition: "x TEXT CHECK (x IS NOT NULL)", refusals: ["x"], defaulted: false },
    { definition: "x TEXT CHECK (x NOT NULL)", refusals: ["x"], defaulted: false },
    { definition: "x TEXT CHECK (x NOTNULL)", refusals: ["x"], defaulted: false },
    { definition: "x TEXT CHECK (NOT x IS NULL)", refusals: ["x"], defaulted: false },
    { definition: "x TEXT CHECK ((x IS NOT NULL) AND length(x) > 0)", refusals: ["x"], defaulted: false },
    { definition: "x TEXT CHECK (x IS NOT NULL OR y IS NULL)", refusals: [], defaulted: false },
    { definition: "x TEXT CHECK (CASE WHEN x IS NOT NULL THEN 1 END)", refusals: [], defaulted: false },
    { definition: "x TEXT CHECK (typeof(x) = 'text')", refusals: [], defaulted: false },
    { definition: "x TEXT CHECK (t.x IS NOT NULL)", refusals: ["x"], defaulted: false },
    { definition: `x TEXT CHECK ("x" IS NOT NULL)`, refusals: ["x"], defaulted: false },
    { definition: "x TEXT CHECK (y IS NOT NULL)", refusals: ["y"], defaulted: false },
    { definition: "x TEXT NOT NULL DEFAULT NULL", refusals: ["x"], defaulted: false },
  ];

  for (const { definition, refusals, defaulted } of cases) {
    it(`reads \`${definition}\``, () => {
      const tokens = spokenSqlTokens(definition);
      expect({ refusals: sqlColumnNullRefusals(tokens), defaulted: sqlColumnHasNonNullDefault(tokens) }).toEqual({ refusals, defaulted });
    });
  }
});

describe("sqlColumnRefusesOwnNull()", () => {
  it("is true only when the column's own name is among the refusals, compared case-insensitively", () => {
    const owns = (definition: string) => sqlColumnRefusesOwnNull(spokenSqlTokens(definition));
    expect({
      own: owns("Nick TEXT CHECK (nick IS NOT NULL)"),
      other: owns("x TEXT CHECK (y IS NOT NULL)"),
      none: owns("x TEXT"),
      empty: owns(""),
    }).toEqual({ own: true, other: false, none: false, empty: false });
  });
});

describe("sqlCheckNullRefusals()", () => {
  it("reads every CHECK body of a constraint clause", () => {
    expect(sqlCheckNullRefusals(spokenSqlTokens("CHECK (a IS NOT NULL) CHECK (b NOTNULL AND c > 0)"))).toEqual(["a", "b"]);
  });
});

describe("spokenSqlTokens() and splitSqlAtDepthZero()", () => {
  it("drops space and comments, offsets each token by the base, and splits at a top-level word or punctuation mark", () => {
    const tokens = spokenSqlTokens("a /* c */ (b, c), d", 10);
    expect({
      first: tokens[0],
      byComma: splitSqlAtDepthZero(tokens, ",").map((part) => part.map((token) => token.text).join(" ")),
      byWord: splitSqlAtDepthZero(spokenSqlTokens("a AND (b AND c)"), "AND").map((part) => part.map((token) => token.text).join(" ")),
    }).toEqual({ first: { kind: "word", text: "a", start: 10, end: 11 }, byComma: ["a ( b , c )", "d"], byWord: ["a", "( b AND c )"] });
  });
});
