import { describe, expect, it } from "bun:test";

import { EditorState } from "@codemirror/state";

import { calloutPattern, viewportDialect } from "./dialect";
import type { ViewportDialect } from "./types";

const ONE: ViewportDialect = { spans: () => [{ kind: "tag", from: 0, to: 2 }], calloutKinds: ["note"] };
const TWO: ViewportDialect = { spans: () => [], calloutKinds: ["tip"] };

describe("viewportDialect", () => {
  it("answers no spans and no callout kinds when no dialect is provided", () => {
    const dialect = EditorState.create().facet(viewportDialect);

    expect([dialect.spans("#t"), dialect.calloutKinds]).toEqual([[], []]);
  });

  it("answers the first dialect provided", () => {
    expect(EditorState.create({ extensions: [viewportDialect.of(ONE), viewportDialect.of(TWO)] }).facet(viewportDialect)).toBe(ONE);
  });
});

describe("calloutPattern", () => {
  it("matches a quote opening with one of the dialect's kinds, in any case", () => {
    const pattern = calloutPattern({ spans: () => [], calloutKinds: ["note", "tip"] });

    expect(["> [!note] T", "> [!TIP]", "> [!aside] T", "[!note]"].map((line) => pattern?.exec(line)?.[1] ?? null)).toEqual([
      "note",
      "TIP",
      null,
      null,
    ]);
  });

  it("reads a kind's regular-expression characters literally", () => {
    const pattern = calloutPattern({ spans: () => [], calloutKinds: ["a.b"] });

    expect([pattern?.test("> [!a.b]"), pattern?.test("> [!axb]")]).toEqual([true, false]);
  });

  it("answers null for a dialect with no callout kinds", () => {
    expect(calloutPattern({ spans: () => [], calloutKinds: [] })).toBeNull();
  });

  it("builds a dialect's pattern once", () => {
    const dialect: ViewportDialect = { spans: () => [], calloutKinds: ["note"] };

    expect(calloutPattern(dialect)).toBe(calloutPattern(dialect));
  });
});
