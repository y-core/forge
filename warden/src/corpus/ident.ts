import { type Corpus, CORPORA } from "../types";

/** The stable identifier of one chunk: `<corpus>:<path>#<section>`. A `§N` section is a
 *  citation a human already writes; a `~slug` marks a heading a reword can move. @public */
export function chunkId(corpus: Corpus, path: string, section: string): string {
  return `${sourceId(corpus, path)}#${section}`;
}

/** The identifier of one document, without a section. @public */
export function sourceId(corpus: Corpus, path: string): string {
  return `${corpus}:${path}`;
}

/** Splits a chunk or source id back into its parts, or `undefined` when it is not one. @public */
export function parseId(id: string): { corpus: Corpus; path: string; section?: string } | undefined {
  const colon = id.indexOf(":");
  if (colon === -1) return undefined;
  const corpus = id.slice(0, colon) as Corpus;
  const rest = id.slice(colon + 1);
  if (!CORPORA.includes(corpus)) return undefined;

  const hash = rest.indexOf("#");
  const path = hash === -1 ? rest : rest.slice(0, hash);
  if (path === "") return undefined;
  const section = hash === -1 ? undefined : rest.slice(hash + 1);
  return { corpus, path, ...(section === undefined || section === "" ? {} : { section }) };
}

/** The corpus a caller named, or `undefined` when it names none.
 *
 *  A misspelled `--corpus` reaches SQL as a literal that matches no row, and an empty result is an
 *  answer this corpus gives deliberately — so without this the reader is told nothing governs their
 *  question when the truth is that they typed `cannon`. @public */
export function parseCorpus(value: string): Corpus | undefined {
  return CORPORA.find((corpus) => corpus === value);
}

/** A heading slug for a corpus with no `§N` numbering. The leading `~` marks it as movable: a
 *  reworded title changes it, where a section number does not. @public */
export function headingSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `~${slug === "" ? "untitled" : slug}`;
}
