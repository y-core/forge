import { findSubpathCitations } from "../checks/docs-parse";
import { type Chunk, CORPORA, type Relation, type SourceDoc } from "../types";
import { sourceId } from "./ident";

const DEFERS = /^>\s*Defers to:/;
const CITATION = /((?:[A-Za-z0-9_-]+\/)?[A-Z_]+\.md)`?\)?\s+§([0-9][A-Za-z0-9]*)/g;
// A defers header names its section the way any citation does, so the scan captures one where the
// prose writes one and resolves to the document otherwise.
const DEFERRED_DOC = /\b((?:[A-Za-z0-9_-]+\/)?[A-Z_]+\.md)`?\)?(?:\s+§([0-9][A-Za-z0-9]*))?/g;

/** What a cited `[tree/]DOC.md` spelling named. @public */
export type Resolution = { kind: "resolved"; id: string } | { kind: "ambiguous"; ids: readonly string[] } | { kind: "none" };

/** Resolves a cited `[tree/]DOC.md` spelling, saying which of the three things happened.
 *
 *  **`resolveDoc` returned `undefined` for both "names nothing" and "names three things", and the
 *  two are different defects.** One is a typo or a renamed document; the other is a citation that
 *  needs a path. Both were dropped in silence, since an unresolved edge only warns and the warning
 *  says the same thing about either.
 *
 *  `from` breaks the tie through an ordered list of tiers. A repository names documents the canon
 *  also names, so `TESTING.md` matches twice almost everywhere; the citing document's own tree
 *  settles a citation between siblings. **The corpus tiers are what make a cross-tree citation
 *  resolve at all**: a `shared` rule citing `libs/ERROR_HANDLING.md` has no same-tree candidate, and
 *  without preferring its own corpus next it lands back among every match. Canon prose means canon
 *  prose, whichever tree carries it.
 *
 *  **`dependency` is last, deliberately.** A bare `TESTING.md` in a consumer's own document never
 *  means the installed library's copy — the reader wrote it about their own repository, and the
 *  library's is the one spelling they would have had to reach for on purpose. @public */
export function resolveCitation(cited: string, sources: readonly SourceDoc[], from?: SourceDoc): Resolution {
  const matches = sources.filter((doc) => doc.path === cited || doc.path.endsWith(`/${cited}`) || `${doc.tree}/${doc.path}` === cited);
  const only = matches[0];
  if (only === undefined) return { kind: "none" };
  if (matches.length === 1) return { kind: "resolved", id: sourceId(only.corpus, only.path) };

  // The list is built from the citing document, so a spelling with no citing document has no list
  // and stays ambiguous — there is nothing to prefer it towards.
  const tiers: ((doc: SourceDoc) => boolean)[] = [];
  if (from !== undefined) {
    tiers.push((doc) => doc.corpus === from.corpus && doc.tree === from.tree);
    tiers.push((doc) => doc.corpus === from.corpus);
    // Only where the citing document's own corpus offers no candidate at all. Once it offers
    // several, another corpus is a different document rather than a narrower reading of the same
    // one — and a canon rule quietly resolved to a repository's own file is worse than a warning.
    if (!matches.some((doc) => doc.corpus === from.corpus)) {
      for (const corpus of CORPORA) tiers.push((doc) => doc.corpus === corpus);
    }
  }

  for (const tier of tiers) {
    const candidates = matches.filter(tier);
    const candidate = candidates[0];
    if (candidates.length === 1 && candidate !== undefined) return { kind: "resolved", id: sourceId(candidate.corpus, candidate.path) };
  }
  return { kind: "ambiguous", ids: matches.map((doc) => sourceId(doc.corpus, doc.path)).sort() };
}

/** The source id a cited spelling names, or `undefined` when it names none or more than one.
 *
 *  The thin wrapper every caller that has nothing to do with an ambiguity still wants. @public */
export function resolveDoc(cited: string, sources: readonly SourceDoc[], from?: SourceDoc): string | undefined {
  const resolution = resolveCitation(cited, sources, from);
  return resolution.kind === "resolved" ? resolution.id : undefined;
}

/** Every edge one document's chunks declare: the `> Defers to:` header, every `§N` citation, and —
 *  given a `packageName` — every subpath a section's prose governs.
 *
 *  An unresolved edge is kept with its raw spelling rather than dropped — the gate warns on it, and
 *  a dropped edge would look like a document that simply cites nothing. @public */
export function relationsOf(
  doc: SourceDoc,
  chunks: readonly Chunk[],
  header: string,
  sources: readonly SourceDoc[],
  packageName?: string,
): Relation[] {
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
      const resolution = resolveCitation(match[1] ?? "", sources, doc);
      relations.push({
        from: chunk.id,
        kind: "cites",
        raw,
        ...(resolution.kind === "resolved" ? { to: `${resolution.id}#${match[2] ?? ""}` } : {}),
        ...(resolution.kind === "ambiguous" ? { ambiguous: resolution.ids } : {}),
      });
    }
  }

  // Prose only: a table row lists a subpath, a rule binds it. A namespace catalog lists every
  // published subpath, so indexing its rows would make one section govern the whole codebase.
  //
  // The target is minted as `code:<subpath>` and is never null. `unresolved()` selects every
  // relation with a null target and the gate reports the count as citations resolving to no
  // indexed document; a `governs` edge is not one of those, and a null would inflate that number
  // with rows working exactly as intended. `parseId` deliberately does not answer for a `code:`
  // id — it is a two-corpus function, and no relation target is ever passed to it.
  if (packageName !== undefined) {
    for (const chunk of chunks) {
      const bound = new Set<string>();
      for (const citation of findSubpathCitations(chunk.body, packageName, { strict: true })) {
        if (citation.kind !== "prose" || bound.has(citation.subpath)) continue;
        bound.add(citation.subpath);
        relations.push({ from: chunk.id, kind: "governs", to: `code:${citation.subpath}`, raw: `${packageName}${citation.raw}` });
      }
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

/** The chunk id a `[tree/]DOC.md §N` citation names, for a corpus that resolves it.
 *
 *  **Delegated rather than its own `find`.** A bare `find` returns the first match in discovery
 *  order, and `discover` puts the canon first — so every filename spelled in two corpora resolved
 *  to the canon's copy whatever the citing document was, and said nothing about it. @public */
export function citationTarget(cited: string, section: string, sources: readonly SourceDoc[], from?: SourceDoc): string | undefined {
  const id = resolveDoc(cited, sources, from);
  return id === undefined ? undefined : `${id}#${section}`;
}
