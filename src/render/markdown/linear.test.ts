import { describe, expect, test } from "bun:test";

import { DIALECT_HANDLERS, parseDialect } from "./dialect.fixture";
import { defineMarkdownSyntax, parseMarkdown, renderMarkdownHtml, walkMarkdown } from "./mod";
import type { MarkdownExtensionInline, MarkdownSyntax } from "./mod";
import { atSize, PATHOLOGICAL_SHAPES } from "./pathological.fixture";
import { SPEC_SCHEMA } from "./spec-schema.fixture";
import { MAX_CONSTRUCT_LENGTH } from "./syntax";

const SMALL = 256 * 1024;
const LARGE = 512 * 1024;
const MAX_RATIO = 3;
const MEBIBYTE = 1024 * 1024;
const BUDGET_MS = 1000;
const RUNS = 5;
// A pause from the collector or the rest of the gate only ever adds time, so every budget is held by the fastest of several runs.
const ATTEMPTS = 3;

const PERCENT = 0x25;

// A construct whose scan reads its whole lookahead before failing: the worst an extension may cost per trigger.
const FAILING_SCAN: MarkdownSyntax = defineMarkdownSyntax({
  inline: [
    {
      name: "unclosed",
      triggers: [PERCENT],
      maxLength: MAX_CONSTRUCT_LENGTH,
      scan: (content, at, limit) => {
        for (let end = at + 1; end + 1 < limit; end++)
          if (content[end] === "%" && content[end + 1] === "%") return { end: end + 2, node: { type: "x" } as unknown as MarkdownExtensionInline };
        return null;
      },
    },
  ],
});

// A construct whose scan ignores its limit and walks to the end of what it is given.
const UNBOUNDED_SCAN: MarkdownSyntax = defineMarkdownSyntax({
  inline: [
    {
      name: "unbounded",
      triggers: [PERCENT],
      maxLength: 8,
      scan: (content, at) => {
        for (let end = at + 1; end < content.length; end++)
          if (content[end] === "!") return { end: end + 1, node: { type: "x" } as unknown as MarkdownExtensionInline };
        return null;
      },
    },
  ],
});

function render(source: string, syntax?: MarkdownSyntax): void {
  renderMarkdownHtml(parseMarkdown(source, syntax), { schema: SPEC_SCHEMA });
}

function elapsed(source: string, syntax?: MarkdownSyntax): number {
  const started = performance.now();
  render(source, syntax);
  return performance.now() - started;
}

function ratioOfFastest(small: string, large: string, syntax?: MarkdownSyntax): number {
  render(small, syntax);
  const smallRuns: number[] = [];
  const largeRuns: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    smallRuns.push(elapsed(small, syntax));
    largeRuns.push(elapsed(large, syntax));
  }
  return Math.min(...largeRuns) / Math.max(Math.min(...smallRuns), 1);
}

describe("parseMarkdown and render grow linearly", () => {
  for (const shape of PATHOLOGICAL_SHAPES) {
    test(`${shape.name}: doubling the input at most ${MAX_RATIO}× the time`, () => {
      const small = atSize(shape, SMALL);
      const large = atSize(shape, LARGE);
      let ratio = ratioOfFastest(small, large);
      for (let attempt = 1; attempt < ATTEMPTS && ratio > MAX_RATIO; attempt++) ratio = ratioOfFastest(small, large);
      expect(ratio).toBeLessThanOrEqual(MAX_RATIO);
    }, 30_000);
  }
});

describe("an extension's lookahead keeps it linear", () => {
  test(`a scan failing after its whole maxLength at every trigger: doubling the input at most ${MAX_RATIO}× the time`, () => {
    const unit = "%" + "a".repeat(40) + " ";
    const small = unit.repeat(Math.floor(SMALL / unit.length));
    const large = unit.repeat(Math.floor(LARGE / unit.length));
    let ratio = ratioOfFastest(small, large, FAILING_SCAN);
    for (let attempt = 1; attempt < ATTEMPTS && ratio > MAX_RATIO; attempt++) ratio = ratioOfFastest(small, large, FAILING_SCAN);
    expect(ratio).toBeLessThanOrEqual(MAX_RATIO);
  }, 60_000);

  test(`a scan that ignores its limit sees only its window: doubling the input at most ${MAX_RATIO}× the time`, () => {
    const small = "%a ".repeat(Math.floor(SMALL / 3));
    const large = "%a ".repeat(Math.floor(LARGE / 3));
    let ratio = ratioOfFastest(small, large, UNBOUNDED_SCAN);
    for (let attempt = 1; attempt < ATTEMPTS && ratio > MAX_RATIO; attempt++) ratio = ratioOfFastest(small, large, UNBOUNDED_SCAN);
    expect(ratio).toBeLessThanOrEqual(MAX_RATIO);
  }, 60_000);
});

describe("a mebibyte of every pathological shape", () => {
  for (const shape of PATHOLOGICAL_SHAPES) {
    test(`${shape.name}: parses under the dialect, renders and walks within ${BUDGET_MS} ms`, () => {
      const source = atSize(shape, MEBIBYTE);
      let fastest = Number.POSITIVE_INFINITY;
      for (let attempt = 0; attempt < ATTEMPTS && fastest > BUDGET_MS; attempt++) {
        const started = performance.now();
        const document = parseDialect(source);
        renderMarkdownHtml(document, { schema: SPEC_SCHEMA, handlers: DIALECT_HANDLERS });
        walkMarkdown(document, () => undefined);
        fastest = Math.min(fastest, performance.now() - started);
      }
      expect(fastest).toBeLessThanOrEqual(BUDGET_MS);
    }, 30_000);
  }
});
