import { findSubpathCitations } from "../checks/docs-parse";
import { type Chunk, type Corpus, CORPORA, type Relation, type SourceDoc } from "../types";
import { sourceId } from "./ident";

const DEFERS = /^>\s*Defers to:/;
// What closes a link around the document name, either way it is written: an inline link ends `)`
// and a reference one ends `][id]`. Neither is required — a bare `X.md §N` in prose is a citation.
const LINK_CLOSE = "`?(?:\\]\\[([^\\]]+)\\]|\\))?";
const CITATION = new RegExp(`((?:[A-Za-z0-9_-]+/)?[A-Z_]+\\.md)${LINK_CLOSE}\\s+§([0-9][A-Za-z0-9]*)`, "g");
// A defers header names its section the way any citation does, so the scan captures one where the
// prose writes one and resolves to the document otherwise.
const DEFERRED_DOC = new RegExp(`\\b((?:[A-Za-z0-9_-]+/)?[A-Z_]+\\.md)${LINK_CLOSE}(?:\\s+§([0-9][A-Za-z0-9]*))?`, "g");

/** The `[tree/]DOC.md` spelling a reference id names, or the link text where nothing defines it. */
function spellingOf(text: string, id: string | undefined, definitions: ReadonlyMap<string, string>): string {
  const destination = id === undefined ? undefined : definitions.get(id.toLowerCase());
  if (destination === undefined) return text;
  const segments = (destination.split("#")[0] ?? "").split("/").filter((part) => part !== "" && part !== "." && part !== "..");
  return segments.slice(-2).join("/");
}

/** The corpora a document of the installed library may cite into. */
const LIBRARY_CORPORA: readonly Corpus[] = ["dependency", "canon"];

/** The prefix a relative href leaves on a library document's citation of its own `docs/`. */
const DOCS_PREFIX = "docs/";

/** What a cited `[tree/]DOC.md` spelling named. @public */
export type Resolution = { kind: "resolved"; id: string } | { kind: "ambiguous"; ids: readonly string[] } | { kind: "none" };

/** Resolves a cited `[tree/]DOC.md` spelling, saying which of the three things happened. @public */
export function resolveCitation(cited: string, sources: readonly SourceDoc[], from?: SourceDoc): Resolution {
  const pool = from?.corpus === "dependency" ? sources.filter((doc) => LIBRARY_CORPORA.includes(doc.corpus)) : sources;
  const find = (spelling: string) =>
    pool.filter((doc) => doc.path === spelling || doc.path.endsWith(`/${spelling}`) || `${doc.tree}/${doc.path}` === spelling);

  let matches = find(cited);
  if (matches.length === 0 && from?.corpus === "dependency" && cited.startsWith(DOCS_PREFIX)) matches = find(cited.slice(DOCS_PREFIX.length));
  const only = matches[0];
  if (only === undefined) return { kind: "none" };
  if (matches.length === 1) return { kind: "resolved", id: sourceId(only.corpus, only.path) };

  // The list is built from the citing document, so a spelling with no citing document has no list
  // and stays ambiguous — there is nothing to prefer it towards.
  const tiers: ((doc: SourceDoc) => boolean)[] = [];
  if (from !== undefined) {
    tiers.push((doc) => doc.corpus === from.corpus && doc.tree === from.tree);
    tiers.push((doc) => doc.corpus === from.corpus);
    // Only where the citing document's own corpus offers no candidate: once it offers several,
    // another corpus is a different document rather than a narrower reading of the same one.
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

/** The source id a cited spelling names, or `undefined` when it names none or more than one. @public */
export function resolveDoc(cited: string, sources: readonly SourceDoc[], from?: SourceDoc): string | undefined {
  const resolution = resolveCitation(cited, sources, from);
  return resolution.kind === "resolved" ? resolution.id : undefined;
}

// A deferral wraps across lines and ends at the blank quote line, so the scan is that slice — never
// the whole header, whose *Owns* paragraph mentions documents it declares no edge to.
function deferralOf(header: string): string | undefined {
  const lines = header.split("\n");
  const start = lines.findIndex((line) => DEFERS.test(line));
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^>\s*$/.test(line));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

/** Every edge one document's chunks declare: its `> Defers to:` header, every `§N` citation, and every subpath its prose governs. @public */
export function relationsOf(
  doc: SourceDoc,
  chunks: readonly Chunk[],
  header: string,
  sources: readonly SourceDoc[],
  packageName?: string,
  definitions: ReadonlyMap<string, string> = new Map(),
): Relation[] {
  const relations: Relation[] = [];
  const docId = sourceId(doc.corpus, doc.path);

  const deferral = deferralOf(header);
  if (deferral !== undefined) {
    // A markdown link names the document twice — as its text and as its href — and only the href is
    // followed by the `§N`, so keying on the resolved target merges the pair into one edge.
    const targets = new Map<string, { raw: string; to?: string }>();
    for (const match of deferral.matchAll(DEFERRED_DOC)) {
      const cited = spellingOf(match[1] ?? "", match[2], definitions);
      const section = match[3];
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
      const cited = spellingOf(match[1] ?? "", match[2], definitions);
      const raw = `${cited} §${match[3] ?? ""}`;
      if (seen.has(raw)) continue;
      seen.add(raw);
      const resolution = resolveCitation(cited, sources, doc);
      relations.push({
        from: chunk.id,
        kind: "cites",
        raw,
        ...(resolution.kind === "resolved" ? { to: `${resolution.id}#${match[3] ?? ""}` } : {}),
        ...(resolution.kind === "ambiguous" ? { ambiguous: resolution.ids } : {}),
      });
    }
  }

  // Prose only: a namespace catalog lists every published subpath, so indexing its table rows would
  // make one section govern the whole codebase.
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

/** The chunk id a `[tree/]DOC.md §N` citation names, for a corpus that resolves it. @public */
export function citationTarget(cited: string, section: string, sources: readonly SourceDoc[], from?: SourceDoc): string | undefined {
  const id = resolveDoc(cited, sources, from);
  return id === undefined ? undefined : `${id}#${section}`;
}
