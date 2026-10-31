import type { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "../index/build";
import { openDatabase } from "../index/db";
import type { SourceDoc } from "../types";
import { bridgeFrequency, coverage, documentFrequency, idf } from "./coverage";
import { FLOOR } from "./search";

const roots: string[] = [];
afterAll(() => {
  for (const tempRoot of roots) rmSync(tempRoot, { recursive: true, force: true });
});

function doc(body: string): string {
  return `---\ntitle: Doc\ndescription: "One."\n---\n\n## 0. Quick Reference\n\n- §1 One: what it decides\n\n## 1. One\n\n${body}\n`;
}

const root = mkdtempSync(join(tmpdir(), "warden-coverage-"));
roots.push(root);
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
  .query<{ rowid: number }, []>("SELECT rowid FROM chunk")
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

describe("bridgeFrequency()", () => {
  it("reads a bridge stemmed and whole, so a short target is not reached by prefix as a typed term is", () => {
    expect(bridgeFrequency(db, "com")).toBe(0);
    expect(documentFrequency(db, "com")).toBe(1);
  });

  it("counts a bridge target the corpus carries", () => {
    expect(bridgeFrequency(db, "budget")).toBe(2);
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
    expect(Math.max(...of("zarquon budget"))).toBeLessThan(0.34);
  });

  it("credits a bridge term, so a paraphrase is not treated as an unanswered question", () => {
    expect(Math.max(...of("captcha"))).toBeGreaterThan(0);
  });

  it("does not count a rare term carried through its bridge as missed, so the paraphrase keeps its full bridge credit", () => {
    const bridging = rowids.indexOf(db.query<{ rowid: number }, []>("SELECT rowid FROM chunk WHERE id = 'project:docs/C.md#1'").get()?.rowid ?? -1);

    expect(of("captcha")[bridging]).toBe(0.5);
  });

  it("credits a typed term above the bridge that stands in for it", () => {
    expect(Math.max(...of("turnstile"))).toBeGreaterThan(Math.max(...of("captcha")));
  });

  it("scores a multi-term aliased query exactly as term-by-term weighting would", () => {
    const total = db.query<{ n: number }, []>("SELECT count(*) AS n FROM chunk").get()?.n ?? 0;
    const expected = rowids.map((rowid) => {
      let earned = 0;
      let missed = 0;
      let whole = 0;
      for (const [term, alias] of [
        ["captcha", "turnstile"],
        ["budget", undefined],
        ["zarquon", undefined],
      ] as const) {
        const frequency = documentFrequency(db, term);
        const weight = idf(total, frequency);
        whole += weight;
        const carries = (word: string) =>
          db
            .query<{ n: number }, [string, number]>("SELECT count(*) AS n FROM chunk_fts WHERE chunk_fts MATCH ? AND rowid = ?")
            .get(`"${word}"`, rowid)?.n === 1;
        if (carries(term)) earned += weight;
        else if (alias !== undefined && carries(alias)) earned += weight * 0.5;
        else if (frequency / total <= 0.02) missed += weight;
      }
      return Number(Math.max(0, (earned - 0.15 * missed) / whole).toFixed(3));
    });

    expect(of("captcha budget zarquon")).toEqual(expected);
  });

  it("returns a zero for every candidate when the query has no usable term", () => {
    expect(of("!!!")).toEqual([0, 0, 0]);
  });
});

describe("a short typed term", () => {
  const shortRoot = mkdtempSync(join(tmpdir(), "warden-coverage-short-"));
  roots.push(shortRoot);
  const sources: SourceDoc[] = [];
  for (const [path, body] of [
    ["docs/IO.md", "Every io call is awaited."],
    ["docs/KEYS.md", "The keys rotate yearly."],
    ["docs/KEY.md", "A key is never logged."],
  ] as const) {
    const file = join(shortRoot, path.replace("/", "-"));
    writeFileSync(file, doc(body), "utf-8");
    sources.push({ corpus: "project", path, file, weight: 1 });
  }
  const short = openDatabase(":memory:");
  build(short, sources, "1.0.0");
  const rowidOf = (id: string) => short.query<{ rowid: number }, [string]>("SELECT rowid FROM chunk WHERE id = ?").get(id)?.rowid ?? -1;

  it("is read unstemmed, so `ios` is not carried by a chunk saying `io`", () => {
    expect(documentFrequency(short, "ios")).toBe(0);
    expect(documentFrequency(short, "io")).toBe(1);
  });

  it("is read by prefix, so `key` is carried by a chunk saying `keys`", () => {
    expect(documentFrequency(short, "key")).toBe(2);
  });

  it("earns a chunk saying only `io` nothing for a query asking about `ios`", () => {
    const io = rowidOf("project:docs/IO.md#1");

    expect(coverage(short, "ios call", [io]).get(io)).toBeLessThan(coverage(short, "io call", [io]).get(io) ?? 0);
    expect(coverage(short, "ios", [io]).get(io)).toBe(0);
  });
});

function statistics(
  total: number,
  carriers: Record<string, number>,
  hits: Record<string, string>,
): { db: Database; rowidOf: (id: string) => number } {
  const measured = openDatabase(":memory:");
  const named = Object.entries(hits);
  const owed = new Map(
    Object.entries(carriers).map(([term, df]) => [term, df - named.filter(([, body]) => body.split(" ").includes(term)).length]),
  );
  const bodies = [
    ...named,
    ...Array.from({ length: total - named.length }, (_, index): [string, string] => {
      const words = [...owed].filter(([, count]) => index < count).map(([term]) => term);
      return [`project:docs/FILLER.md#${index}`, words.length === 0 ? "filler" : words.join(" ")];
    }),
  ];

  measured.transaction(() => {
    const source = measured
      .query<{ id: number }, []>(
        "INSERT INTO source (corpus, tree, path, title, description, weight, size, mtime, hash) VALUES ('project', NULL, 'docs/FIXTURE.md', '', '', 1, 0, 0, '') RETURNING id",
      )
      .get()?.id;
    const chunk = measured.prepare<{ rowid: number }, [string, number, string]>(
      "INSERT INTO chunk (id, source_id, section, title, heading_path, gloss, rules, body, ordinal, searchable, line, end_line) VALUES (?, ?, '1', '', '', '', '', ?, 0, 1, 1, 1) RETURNING rowid",
    );
    const search = measured.prepare<never, [number, string]>(
      "INSERT INTO chunk_fts (rowid, title, heading_path, gloss, rules, search_body) VALUES (?, '', '', '', '', ?)",
    );
    const exact = measured.prepare<never, [number, string]>(
      "INSERT INTO chunk_exact (rowid, title, heading_path, gloss, rules, search_body) VALUES (?, '', '', '', '', ?)",
    );
    for (const [id, body] of bodies) {
      const rowid = chunk.get(id, source ?? 0, body)?.rowid ?? 0;
      search.run(rowid, body);
      exact.run(rowid, body);
    }
  })();

  const rowidOf = (id: string) => measured.query<{ rowid: number }, [string]>("SELECT rowid FROM chunk WHERE id = ?").get(id)?.rowid ?? -1;
  return { db: measured, rowidOf };
}

const IOS_QUERY = "how is an ios app store receipt validated";

const COMMON_ONLY = ["docs/FORGE_ERRORS.md#5e", "docs/SECURITY_HARDENING.md#2a", "docs/SECURITY_HARDENING.md#2f", "docs/SECURITY_HARDENING.md#3f"];

const BRIDGED = "docs/BRIDGED.md#1";

const MEASURED = [
  { corpus: "forge", prefix: "project:", total: 1403, carriers: { ios: 2, app: 220, store: 112, receipt: 7, validated: 121, purchase: 1 } },
  {
    corpus: "cad-forge",
    prefix: "dependency:forge/",
    total: 1091,
    carriers: { ios: 4, app: 183, store: 118, receipt: 2, validated: 114, purchase: 1 },
  },
] as const;

for (const { corpus, prefix, total, carriers } of MEASURED) {
  describe(`coverage() against ${corpus}'s measured corpus statistics`, () => {
    const hits = {
      ...Object.fromEntries(COMMON_ONLY.map((id) => [`${prefix}${id}`, "app store validated"])),
      [`${prefix}${BRIDGED}`]: "app store validated purchase",
    };
    const fixture = statistics(total, carriers, hits);
    const common = COMMON_ONLY.map((id) => fixture.rowidOf(`${prefix}${id}`));
    const weight = (term: keyof typeof carriers) => idf(total, carriers[term]);
    const plain = weight("app") + weight("store") + weight("validated");
    const whole = plain + weight("ios") + weight("receipt");

    it("reproduces the measured chunk count and every query term's document frequency", () => {
      expect(fixture.db.query<{ n: number }, []>("SELECT count(*) AS n FROM chunk").get()?.n).toBe(total);
      expect(Object.fromEntries(Object.keys(carriers).map((term) => [term, documentFrequency(fixture.db, term)]))).toEqual(carriers);
    });

    it("reproduces the defect: a common-terms-only hit's plain IDF share clears the floor", () => {
      expect(plain / whole).toBeGreaterThanOrEqual(FLOOR);
    });

    it("scores every hit carrying only the query's common terms below the floor", () => {
      const scores = coverage(fixture.db, IOS_QUERY, common);

      expect(Math.max(...common.map((rowid) => scores.get(rowid) ?? 1))).toBeLessThan(FLOOR);
    });

    it("gives a hit carrying every term of a query with no rare term the whole of it", () => {
      expect(coverage(fixture.db, "app store validated", common).get(common[0] ?? -1)).toBe(1);
    });

    it("leaves a hit missing only a common term at its plain IDF share", () => {
      const share = plain / (plain + idf(total, documentFrequency(fixture.db, "filler")));

      expect(coverage(fixture.db, "app store validated filler", common).get(common[0] ?? -1)).toBeCloseTo(share, 10);
    });

    it("charges a hit that bridges a rare term only for the rare term it misses outright", () => {
      const bridged = fixture.rowidOf(`${prefix}${BRIDGED}`);
      const expected = (plain + weight("receipt") * 0.5 - weight("ios") * 0.15) / whole;

      expect(coverage(fixture.db, IOS_QUERY, [bridged], new Map([["receipt", ["purchase"]]])).get(bridged)).toBeCloseTo(expected, 10);
    });
  });
}
