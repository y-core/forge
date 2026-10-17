import { describe, expect, test } from "bun:test";

import { DIALECT_HANDLERS, parseDialect } from "./dialect.fixture";
import { defineMarkdownSyntax, parseMarkdown, renderMarkdownHtml, walkMarkdown } from "./mod";
import type { MarkdownExtensionInline, MarkdownSyntax } from "./mod";
import { atSize, PATHOLOGICAL_SHAPES } from "./pathological.fixture";
import { SPEC_SCHEMA } from "./spec-schema.fixture";
import { MAX_CONSTRUCT_LENGTH } from "./syntax";

const SMALL = 8 * 1024;
const GROWTH = 8;
const LARGE = SMALL * GROWTH;
const MAX_RATIO = 2 * GROWTH;
const MAX_COST_OF_PLAIN = 8;
const PLAIN_LINE = "plain words in a paragraph line\n\n";
const RUNS = 3;
const LOOKBEHIND = 2;
// A pause from the collector or the rest of the gate only ever adds time, so every budget is held by the fastest of several runs.
const ATTEMPTS = 3;

const PERCENT = 0x25;
const NO_MATCH = { type: "x" } as unknown as MarkdownExtensionInline;

function countOf(source: string, char: string): number {
  return source.split(char).length - 1;
}

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
  return Math.min(...largeRuns) / Math.max(Math.min(...smallRuns), 0.05);
}

describe("parseMarkdown and render grow linearly", () => {
  for (const shape of PATHOLOGICAL_SHAPES) {
    test(`${shape.name}: growing the input ${GROWTH}× costs at most ${MAX_RATIO}× the time`, () => {
      const small = atSize(shape, SMALL);
      const large = atSize(shape, LARGE);
      let ratio = ratioOfFastest(small, large);
      for (let attempt = 1; attempt < ATTEMPTS && ratio > MAX_RATIO; attempt++) ratio = ratioOfFastest(small, large);
      expect(ratio).toBeLessThanOrEqual(MAX_RATIO);
    }, 60_000);
  }
});

describe("an extension's lookahead keeps it linear", () => {
  test("a scan failing after its whole maxLength at every trigger reads at most lookbehind + maxLength per trigger", () => {
    let calls = 0;
    let read = 0;
    const syntax = defineMarkdownSyntax({
      inline: [
        {
          name: "unclosed",
          triggers: [PERCENT],
          maxLength: MAX_CONSTRUCT_LENGTH,
          scan: (content, at, limit) => {
            calls += 1;
            read += limit - at;
            for (let end = at + 1; end + 1 < limit; end++)
              if (content[end] === "%" && content[end + 1] === "%") return { end: end + 2, node: NO_MATCH };
            return null;
          },
        },
      ],
    });
    const unit = "%" + "a".repeat(40) + " ";
    const source = unit.repeat(Math.ceil((4 * MAX_CONSTRUCT_LENGTH) / unit.length));
    render(source, syntax);
    expect(calls).toBe(countOf(source, "%"));
    expect(read).toBeLessThanOrEqual(calls * MAX_CONSTRUCT_LENGTH);
  });

  test("a scan that ignores its limit sees only its window", () => {
    let calls = 0;
    let widest = 0;
    const syntax = defineMarkdownSyntax({
      inline: [
        {
          name: "unbounded",
          triggers: [PERCENT],
          maxLength: 8,
          scan: (content, at) => {
            calls += 1;
            widest = Math.max(widest, content.length);
            for (let end = at + 1; end < content.length; end++) if (content[end] === "!") return { end: end + 1, node: NO_MATCH };
            return null;
          },
        },
      ],
    });
    const source = "%a ".repeat(1024);
    render(source, syntax);
    expect(widest).toBeLessThanOrEqual(LOOKBEHIND + 8);
    expect(calls).toBe(countOf(source, "%"));
  });
});

function processed(source: string): number {
  const started = performance.now();
  const document = parseDialect(source);
  renderMarkdownHtml(document, { schema: SPEC_SCHEMA, handlers: DIALECT_HANDLERS });
  walkMarkdown(document, () => undefined);
  return performance.now() - started;
}

describe("64 KiB of every pathological shape costs a bounded multiple of 64 KiB of plain paragraphs", () => {
  const plain = PLAIN_LINE.repeat(Math.floor(LARGE / PLAIN_LINE.length));
  for (const shape of PATHOLOGICAL_SHAPES) {
    test(`${shape.name}: parses under the dialect, renders and walks within ${MAX_COST_OF_PLAIN}× the plain 64 KiB`, () => {
      const source = atSize(shape, LARGE);
      let fastestPlain = processed(plain);
      let fastestShape = processed(source);
      for (let attempt = 1; attempt < ATTEMPTS && fastestShape > MAX_COST_OF_PLAIN * fastestPlain; attempt++) {
        fastestPlain = Math.min(fastestPlain, processed(plain));
        fastestShape = Math.min(fastestShape, processed(source));
      }
      expect(fastestShape / fastestPlain).toBeLessThanOrEqual(MAX_COST_OF_PLAIN);
    }, 60_000);
  }
});
