import type { Chunk, Relation, SourceDoc } from "../types";
import { chunkId, sourceId } from "./ident";

const DEFERS = /^>\s*Defers to:/;
const CITATION = /((?:[A-Za-z0-9_-]+\/)?[A-Z_]+\.md)`?\)?\s+§([0-9][A-Za-z0-9]*)/g;
// A defers header names its section the way any citation does, so the scan captures one where the
// prose writes one and resolves to the document otherwise.
const DEFERRED_DOC = /\b((?:[A-Za-z0-9_-]+\/)?[A-Z_]+\.md)`?\)?(?:\s+§([0-9][A-Za-z0-9]*))?/g;

/** Resolves a cited `[tree/]DOC.md` spelling to a source id, or `undefined` when it names none or
 *  more than one — an ambiguous citation is left unresolved rather than guessed at.
 *
 *  `from` breaks the tie, and it does so in two steps rather than one. A repository names documents
 *  the canon also names, so `TESTING.md` matches twice almost everywhere; the first step, the citing
 *  document's own tree, settles a citation between siblings. **The second step is what makes a
 *  cross-tree citation resolve at all**: a `shared` rule citing `libs/ERROR_HANDLING.md` has no
 *  same-tree candidate, and without preferring its own corpus next it lands back among both matches
 *  and is dropped — silently, since an unresolved edge only warns. Corpus is the meaningful
 *  boundary here: canon prose means canon prose, whichever tree carries it. @public */
export function resolveDoc(cited: string, sources: readonly SourceDoc[], from?: SourceDoc): string | undefined {
  const matches = sources.filter((doc) => doc.path === cited || doc.path.endsWith(`/${cited}`) || `${doc.tree}/${doc.path}` === cited);
  const sameTree = from === undefined ? [] : matches.filter((doc) => doc.corpus === from.corpus && doc.tree === from.tree);
  const sameCorpus = from === undefined ? [] : matches.filter((doc) => doc.corpus === from.corpus);
  const candidates = sameTree.length === 1 ? sameTree : sameCorpus.length === 1 ? sameCorpus : matches;
  const only = candidates[0];
  return candidates.length === 1 && only !== undefined ? sourceId(only.corpus, only.path) : undefined;
}

/** Every edge one document's chunks declare: the `> Defers to:` header, and every `§N` citation.
 *
 *  An unresolved edge is kept with its raw spelling rather than dropped — the gate warns on it, and
 *  a dropped edge would look like a document that simply cites nothing. @public */
export function relationsOf(doc: SourceDoc, chunks: readonly Chunk[], header: string, sources: readonly SourceDoc[]): Relation[] {
  const relations: Relation[] = [];
  const docId = sourceId(doc.corpus, doc.path);

  if (DEFERS.test(header.split("\n").find((line) => DEFERS.test(line)) ?? "")) {
    // A markdown link names the document twice — once as its text, once as its href — and only the
    // href is followed by the `§N`. Keying on the resolved target merges the pair where the raw
    // spellings differ (`X.md` and `tree/X.md` are one edge), and the section-bearing one wins.
    const targets = new Map<string, { raw: string; to?: string }>();
    for (const match of header.matchAll(DEFERRED_DOC)) {
      const cited = match[1] ?? "";
      const section = match[2];
      const target = resolveDoc(cited, sources, doc);
      const to = target === undefined || section === undefined ? target : `${target}#${section}`;
      const held = targets.get(target ?? cited);
      if (held !== undefined && (section === undefined || held.raw.includes(" §"))) continue;
      targets.set(target ?? cited, { raw: section === undefined ? cited : `${cited} §${section}`, ...(to === undefined ? {} : { to }) });
    }
    for (const entry of targets.values()) relations.push({ from: docId, kind: "defers", ...entry });
  }

  for (const chunk of chunks) {
    const seen = new Set<string>();
    for (const match of `${chunk.body}`.matchAll(CITATION)) {
      const raw = `${match[1] ?? ""} §${match[2] ?? ""}`;
      if (seen.has(raw)) continue;
      seen.add(raw);
      const target = resolveDoc(match[1] ?? "", sources, doc);
      const to = target === undefined ? undefined : `${target}#${match[2] ?? ""}`;
      relations.push({ from: chunk.id, kind: "cites", raw, ...(to === undefined ? {} : { to }) });
    }
  }

  return relations;
}

/** The header block of a document — everything before its first `## `. @public */
export function headerOf(source: string): string {
  const lines = source.split("\n");
  const first = lines.findIndex((line) => line.startsWith("## "));
  return (first === -1 ? lines : lines.slice(0, first)).join("\n");
}

/** The chunk id a `[tree/]DOC.md §N` citation names, for a corpus that resolves it. @public */
export function citationTarget(cited: string, section: string, sources: readonly SourceDoc[]): string | undefined {
  const doc = sources.find((entry) => entry.path === cited || entry.path.endsWith(`/${cited}`));
  return doc === undefined ? undefined : chunkId(doc.corpus, doc.path, section);
}
