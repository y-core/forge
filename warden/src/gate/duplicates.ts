import { checkResult, scannedNothing, warn } from "../../../src/tooling/gate/finding";
import type { CheckResult, Finding } from "../../../src/tooling/gate/types";
import { type DependencyOptions, dependencyRootOf } from "../corpus/dependency";
import { fnv1a } from "../corpus/hash";
import { discover } from "../corpus/source";
import { load } from "../index/build";
import type { Tree } from "../types";

/** What the duplication check needs to know about the project. @public */
export interface DuplicateCheckConfig extends DependencyOptions {
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

/** How many words one shingle spans. */
const WIDTH = 5;

/** The Jaccard overlap at which two sections are reported as saying the same thing twice. */
const THRESHOLD = 0.28;

/** How many pairs are reported. */
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

/** One reported pair, with the class it sorts under. @public */
export interface DuplicatePair {
  a: string;
  b: string;
  score: number;
  /** 0 a `docs/` section against the canon, 1 a README against a document, 2 anything else. */
  klass: number;
}

/** Every pair at or above the threshold, classified and ordered exactly as the check reports them. @public */
export function duplicatePairs(config: DuplicateCheckConfig): DuplicatePair[] {
  const dependencyRoot = dependencyRootOf(config, config.root);
  const sources = discover(config.root, config.kind, {
    ...(config.docsDir === undefined ? {} : { docsDir: config.docsDir }),
    ...(config.canonRoot === undefined ? {} : { canonRoot: config.canonRoot }),
    ...(dependencyRoot === undefined ? {} : { dependencyRoot }),
  });
  const docsDir = config.docsDir ?? "docs";
  const { pairs } = score(shingle(sources), config.threshold ?? THRESHOLD);
  return pairs
    .map((pair) => ({ a: pair.a.id, b: pair.b.id, score: pair.score, klass: klass(pair, docsDir) }))
    .sort((left, right) => left.klass - right.klass || right.score - left.score || (left.a < right.a ? -1 : 1));
}

/** Reports two sections that say the same thing, which the single-home rule forbids. @public */
export function checkDuplicates(config: DuplicateCheckConfig): CheckResult {
  const threshold = config.threshold ?? THRESHOLD;
  const dependencyRoot = dependencyRootOf(config, config.root);
  const sources = discover(config.root, config.kind, {
    ...(config.docsDir === undefined ? {} : { docsDir: config.docsDir }),
    ...(config.canonRoot === undefined ? {} : { canonRoot: config.canonRoot }),
    ...(dependencyRoot === undefined ? {} : { dependencyRoot }),
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

/** Every searchable chunk as a set of hashed word shingles. */
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

/** Exact Jaccard over every pair sharing at least one shingle, through an inverted index. */
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

/** Which class a pair belongs to, lowest first. */
function klass(pair: Pair, docsDir: string): number {
  const corpora = [pair.a.corpus, pair.b.corpus];
  const canon = corpora.filter((corpus) => corpus === "canon").length;
  const docs = [pair.a, pair.b].filter((section) => section.path.startsWith(`${docsDir}/`)).length;
  if (canon === 1 && docs === 1) return 0;
  // Tested before the README class: the library serves READMEs too, so that class would otherwise
  // claim an advisory pair first and fill the reporting cap with it.
  if (corpora.includes("dependency")) return 3;
  const readmes = [pair.a, pair.b].filter((section) => section.path.endsWith("README.md")).length;
  return readmes === 1 ? 1 : 2;
}
