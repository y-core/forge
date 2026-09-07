import type { Chunk, Relation, SourceDoc } from "../types";
import { chunkId, sourceId } from "./ident";

const DEFERS = /^>\s*Defers to:/;
const CITATION = /((?:[A-Za-z0-9_-]+\/)?[A-Z_]+\.md)`?\)?\s+§([0-9][A-Za-z0-9]*)/g;
const BARE_DOC = /\b((?:[A-Za-z0-9_-]+\/)?[A-Z_]+\.md)\b/g;

/** Resolves a cited `[tree/]DOC.md` spelling to a source id, or `undefined` when it names none or
 *  more than one — an ambiguous citation is left unresolved rather than guessed at.
 *
 *  `from` breaks the commonest tie: forge names documents the canon also names, and a citation
 *  inside a canon document means its sibling, not this repository's like-named one. @public */
export function resolveDoc(cited: string, sources: readonly SourceDoc[], from?: SourceDoc): string | undefined {
  const matches = sources.filter((doc) => doc.path === cited || doc.path.endsWith(`/${cited}`) || `${doc.tree}/${doc.path}` === cited);
  const sameHome = from === undefined ? [] : matches.filter((doc) => doc.corpus === from.corpus && doc.tree === from.tree);
  const candidates = sameHome.length === 1 ? sameHome : matches;
  const only = candidates[0];
  return candidates.length === 1 && only !== undefined ? sourceId(only.corpus, only.tree, only.path) : undefined;
}

/** Every edge one document's chunks declare: the `> Defers to:` header, and every `§N` citation.
 *
 *  An unresolved edge is kept with its raw spelling rather than dropped — the gate warns on it, and
 *  a dropped edge would look like a document that simply cites nothing. @public */
export function relationsOf(doc: SourceDoc, chunks: readonly Chunk[], header: string, sources: readonly SourceDoc[]): Relation[] {
  const relations: Relation[] = [];
  const docId = sourceId(doc.corpus, doc.tree, doc.path);

  if (DEFERS.test(header.split("\n").find((line) => DEFERS.test(line)) ?? "")) {
    // A markdown link names the document twice — once as its text, once as its href — so the raw
    // spelling is what deduplicates, not the match count.
    for (const raw of new Set([...header.matchAll(BARE_DOC)].map((match) => match[1] ?? ""))) {
      const to = resolveDoc(raw, sources, doc);
      relations.push({ from: docId, kind: "defers", raw, ...(to === undefined ? {} : { to }) });
    }
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
  return doc === undefined ? undefined : chunkId(doc.corpus, doc.tree, doc.path, section);
}
