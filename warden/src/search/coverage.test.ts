import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "../index/build";
import { openDatabase } from "../index/db";
import type { SourceDoc } from "../types";
import { coverage, documentFrequency, idf } from "./coverage";

function doc(body: string): string {
  return `---\ntitle: Doc\ndescription: "One."\n---\n\n## 0. Quick Reference\n\n- §1 One: what it decides\n\n## 1. One\n\n${body}\n`;
}

const root = mkdtempSync(join(tmpdir(), "warden-coverage-"));
const CORPUS: SourceDoc[] = [];
for (const [path, body] of [
  ["docs/A.md", "The comment budget is a ceiling on prose."],
  ["docs/B.md", "A honeypot field is never shown to a person."],
  ["docs/C.md", "The budget for a turnstile is decided elsewhere."],
] as const) {
  const file = join(root, path.replace("/", "-"));
  writeFileSync(file, doc(body), "utf-8");
  CORPUS.push({ corpus: "project", path, file, weight: 1 });
}

const db = openDatabase(":memory:");
build(db, CORPUS, "1.0.0");

const rowids = db
  .query<{ rowid: number }>("SELECT rowid FROM chunk")
  .all()
  .map((row) => row.rowid);

function of(query: string): number[] {
  const scores = coverage(db, query, rowids);
  return rowids.map((rowid) => Number((scores.get(rowid) ?? 0).toFixed(3)));
}

describe("idf()", () => {
  it("scores a rarer term above a common one", () => {
    expect(idf(1000, 1)).toBeGreaterThan(idf(1000, 500));
  });

  it("scores a term the corpus has never seen far above its rarest, because absence is not rarity", () => {
    expect(idf(1000, 0)).toBeGreaterThan(idf(1000, 1) * 1.5);
  });
});

describe("documentFrequency()", () => {
  it("counts through the index's own tokenizer, so a stemmed form is the same term", () => {
    expect(documentFrequency(db, "budget")).toBe(2);
    expect(documentFrequency(db, "ceiling")).toBe(1);
  });

  it("returns zero for a term the corpus does not carry", () => {
    expect(documentFrequency(db, "zarquon")).toBe(0);
  });
});

describe("coverage()", () => {
  it("gives a chunk carrying every term the whole of it", () => {
    expect(of("comment budget ceiling")[0]).toBe(1);
  });

  it("gives a chunk carrying none of them nothing", () => {
    expect(of("honeypot")[0]).toBe(0);
  });

  it("drags every candidate down when a term is absent from the corpus entirely", () => {
    // `budget` is carried, `zarquon` is carried by nothing — so the best possible hit is partial,
    // which is the verdict that lets a caller refuse the whole query.
    expect(Math.max(...of("zarquon budget"))).toBeLessThan(0.34);
  });

  it("credits a bridge term, so a paraphrase is not treated as an unanswered question", () => {
    // `captcha` appears nowhere; `turnstile`, its alias, is in docs/C.md.
    expect(Math.max(...of("captcha"))).toBeGreaterThan(0);
  });

  it("credits a typed term above the bridge that stands in for it", () => {
    expect(Math.max(...of("turnstile"))).toBeGreaterThan(Math.max(...of("captcha")));
  });

  it("scores a multi-term aliased query exactly as term-by-term weighting would", () => {
    // The batched posting-list read has to be arithmetically the same as one `documentFrequency`
    // and one pool intersection per term — this is what pins that.
    const total = db.query<{ n: number }>("SELECT count(*) AS n FROM chunk").get()?.n ?? 0;
    const expected = rowids.map((rowid) => {
      let earned = 0;
      let whole = 0;
      for (const [term, alias] of [
        ["captcha", "turnstile"],
        ["budget", undefined],
        ["zarquon", undefined],
      ] as const) {
        const weight = idf(total, documentFrequency(db, term));
        whole += weight;
        const carries = (word: string) =>
          db.query<{ n: number }>("SELECT count(*) AS n FROM chunk_fts WHERE chunk_fts MATCH ? AND rowid = ?").get(`"${word}"`, rowid)?.n === 1;
        if (carries(term)) earned += weight;
        else if (alias !== undefined && carries(alias)) earned += weight * 0.5;
      }
      return Number((earned / whole).toFixed(3));
    });

    expect(of("captcha budget zarquon")).toEqual(expected);
  });

  it("returns a zero for every candidate when the query has no usable term", () => {
    expect(of("!!!")).toEqual([0, 0, 0]);
  });
});
