import { type CheckResult, checkResult, type Finding, scannedNothing, warn } from "../../../src/tooling/gate/finding";
import { fnv1a } from "../corpus/hash";
import { discover } from "../corpus/source";
import { load } from "../index/build";
import type { Tree } from "../types";

/** What the duplication check needs to know about the project. @public */
export interface DuplicateCheckConfig {
  /** Repository root. */
  root: string;
  /** The canon tree this repository is subject to. */
  kind: Tree;
  /** Directory of this repository's own governing documents. Defaults to `docs`. */
  docsDir?: string;
  /** The canon root. Defaults to the installed one, which is where a consumer's canon comes from. */
  canonRoot?: string;
  /** Replaces the calibrated threshold. */
  threshold?: number;
}

/** How many words one shingle spans. Five is long enough that a shared clause is shared prose rather
 *  than shared vocabulary, and short enough to survive a rewritten sentence around it. */
const WIDTH = 5;

/** The Jaccard overlap at which two sections are reported as saying the same thing twice.
 *
 *  **Calibrated, not chosen.** The first run reported seven pairs from 0.290 to 0.625 and every one
 *  was a real second home, resolved by making `docs/` cite the canon section it had been restating.
 *  Below them the highest legitimate pair measures 0.250 — `docs/TESTING.md` §3c stating the
 *  render-once rule in this repository's own vocabulary, short enough that one shared clause
 *  dominates it — and the lowest pair the sweep removed measured 0.290. This sits between them, so
 *  the corpus now clears it with the whole distribution below 0.28 and the next restatement to grow
 *  past a legitimate one fires.
 *
 *  The `warden:duplicates` gate step reports the pair count and the highest score every run, so the
 *  distribution is watched rather than assumed — move this only with that summary in hand, and only
 *  after reading the pairs the move would silence.
 *
 *  The method is CBM's clone detection; its own 0.95 is over AST node-type trigrams and does not
 *  transfer to prose, where two sections stating one rule share far less of their wording than two
 *  copies of a function share of their structure. */
const THRESHOLD = 0.28;

/** How many pairs are reported. A first run over a corpus that has never been swept is long, and a
 *  finding list nobody reads is worth less than a count. */
const CAP = 20;

interface Section {
  id: string;
  path: string;
  corpus: string;
  shingles: Set<number>;
}

interface Pair {
  a: Section;
  b: Section;
  score: number;
}

/** Reports two sections that say the same thing, which the single-home rule forbids.
 *
 *  Works off a corpus parse rather than the index: `search_body` lives only in the FTS table and in
 *  memory, never in a column this could read back. Every finding is a warning — a specialisation
 *  legitimately restates the rule it narrows, so a pair above the threshold is evidence to read,
 *  not a build to stop. @public */
export function checkDuplicates(config: DuplicateCheckConfig): CheckResult {
  const threshold = config.threshold ?? THRESHOLD;
  const sources = discover(config.root, config.kind, {
    ...(config.docsDir === undefined ? {} : { docsDir: config.docsDir }),
    ...(config.canonRoot === undefined ? {} : { canonRoot: config.canonRoot }),
  });

  if (sources.length === 0) {
    return scannedNothing("discovery found no document to compare — the corpus roots are wrong", "warden:duplicates", "read");
  }

  const sections = shingle(sources);
  const { pairs, highest } = score(sections, threshold);
  const docsDir = config.docsDir ?? "docs";
  pairs.sort((left, right) => klass(left, docsDir) - klass(right, docsDir) || right.score - left.score);

  const findings: Finding[] = pairs
    .slice(0, CAP)
    .map((pair) =>
      warn(`\`${pair.a.id}\` and \`${pair.b.id}\` overlap ${pair.score.toFixed(3)} — one of them should narrow the other, not restate it`, {
        file: pair.a.path,
      }),
    );

  const suppressed = pairs.length - findings.length;
  return checkResult(
    findings,
    `${sections.length} searchable chunks, ${pairs.length} pair${pairs.length === 1 ? "" : "s"} at or above ${threshold.toFixed(2)}, highest ${highest.toFixed(3)}${suppressed > 0 ? `, ${suppressed} not shown` : ""}.`,
  );
}

/** Every searchable chunk as a set of hashed word shingles. An organising stub is skipped: it has no
 *  prose of its own, so anything it shares is its children's. */
function shingle(sources: Parameters<typeof load>[0]): Section[] {
  const sections: Section[] = [];
  for (const entry of load(sources)) {
    for (const chunk of entry.chunks) {
      if (!chunk.searchable) continue;
      const words = chunk.searchBody.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const shingles = new Set<number>();
      for (let i = 0; i + WIDTH <= words.length; i++) {
        shingles.add(Number.parseInt(fnv1a(words.slice(i, i + WIDTH).join(" ")), 16));
      }
      if (shingles.size > 0) sections.push({ id: chunk.id, path: entry.doc.path, corpus: entry.doc.corpus, shingles });
    }
  }
  return sections;
}

/** Exact Jaccard over every pair sharing at least one shingle. The inverted index is what makes that
 *  affordable: at this corpus size the candidate set is small enough that the estimate a MinHash
 *  sketch would buy is a worse answer than the real number. */
function score(sections: readonly Section[], threshold: number): { pairs: Pair[]; highest: number } {
  const postings = new Map<number, number[]>();
  sections.forEach((section, index) => {
    for (const hash of section.shingles) {
      const bucket = postings.get(hash);
      if (bucket === undefined) postings.set(hash, [index]);
      else bucket.push(index);
    }
  });

  const pairs: Pair[] = [];
  let highest = 0;
  sections.forEach((left, index) => {
    const shared = new Map<number, number>();
    for (const hash of left.shingles) {
      for (const other of postings.get(hash) ?? []) {
        if (other > index) shared.set(other, (shared.get(other) ?? 0) + 1);
      }
    }
    for (const [other, count] of shared) {
      const right = sections[other];
      if (right === undefined) continue;
      const jaccard = count / (left.shingles.size + right.shingles.size - count);
      highest = Math.max(highest, jaccard);
      if (jaccard >= threshold) pairs.push({ a: left, b: right, score: jaccard });
    }
  });
  return { pairs, highest };
}

/** Which class a pair belongs to, lowest first. The two the single-home rule is actually about lead:
 *  a `docs/` section against the canon rule it should be citing, then a README against the document
 *  it should be pointing at. */
function klass(pair: Pair, docsDir: string): number {
  const canon = [pair.a, pair.b].filter((section) => section.corpus === "canon").length;
  const docs = [pair.a, pair.b].filter((section) => section.path.startsWith(`${docsDir}/`)).length;
  if (canon === 1 && docs === 1) return 0;
  const readmes = [pair.a, pair.b].filter((section) => section.path.endsWith("README.md")).length;
  return readmes === 1 ? 1 : 2;
}
