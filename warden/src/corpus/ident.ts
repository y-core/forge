import type { Corpus, Tree } from "../types";

/** The stable identifier of one chunk: `<corpus>[/<tree>]:<path>#<section>`. A `§N` section is a
 *  citation a human already writes; a `~slug` marks a heading a reword can move. @public */
export function chunkId(corpus: Corpus, tree: Tree | undefined, path: string, section: string): string {
  return `${sourceId(corpus, tree, path)}#${section}`;
}

/** The identifier of one document, without a section. @public */
export function sourceId(corpus: Corpus, tree: Tree | undefined, path: string): string {
  return `${tree === undefined ? corpus : `${corpus}/${tree}`}:${path}`;
}

/** Splits a chunk or source id back into its parts, or `undefined` when it is not one. @public */
export function parseId(id: string): { corpus: Corpus; tree?: Tree; path: string; section?: string } | undefined {
  const colon = id.indexOf(":");
  if (colon === -1) return undefined;
  const head = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  const slash = head.indexOf("/");
  const corpus = slash === -1 ? head : head.slice(0, slash);
  if (corpus !== "canon" && corpus !== "local") return undefined;
  const tree = slash === -1 ? undefined : head.slice(slash + 1);
  if (tree !== undefined && tree !== "shared" && tree !== "libs" && tree !== "apps") return undefined;

  const hash = rest.indexOf("#");
  const path = hash === -1 ? rest : rest.slice(0, hash);
  if (path === "") return undefined;
  const section = hash === -1 ? undefined : rest.slice(hash + 1);
  return { corpus, ...(tree === undefined ? {} : { tree }), path, ...(section === undefined || section === "" ? {} : { section }) };
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
