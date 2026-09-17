/** The corpus tree a repository clones. @public */
export type Kind = "libs" | "apps";

/** One tree a sync replaces wholesale: where it comes from, and where it lands. @public */
export interface SyncTree {
  /** Destination, relative to the repository root. */
  tree: string;
  /** Sources, absolute, inside the installed warden directory, layered in order. */
  from: readonly string[];
}

/** One file a sync writes only when it is absent. @public */
export interface SeedFile {
  /** Destination, relative to the repository root. */
  file: string;
  /** Source, absolute, inside the installed warden directory. */
  from: string;
}

/** What a sync did to one path. @public */
export type SyncOutcome = "synced" | "seeded" | "kept";

/** One line of a `warden sync --check` report. @public */
export interface Divergence {
  /** `missing`, `modified`, `extra`, `undefined`, `unnamed` or `absent`. */
  code: string;
  /** What diverged, and what to do about it. */
  detail: string;
}

/** Which corpus a document belongs to: the fleet's, this repository's own, or an installed dependency's. @public */
export type Corpus = "canon" | "project" | "dependency";

/** Every corpus, in the order a tie between them is settled. @public */
export const CORPORA: readonly Corpus[] = ["canon", "project", "dependency"];

/** Which canon tree a document belongs to. Project documents carry none. @public */
export type Tree = "shared" | "libs" | "apps";

/** One indexable document, before it is read. @public */
export interface SourceDoc {
  corpus: Corpus;
  tree?: Tree;
  /** Repository-relative for `project`, canon-relative for `canon` — the spelling a citation uses. */
  path: string;
  /** Absolute path on disk. */
  file: string;
  /** Retrieval weight, derived from the path and therefore incapable of drifting. */
  weight: number;
}

/** One indexed section. @public */
export interface Chunk {
  id: string;
  /** `§N` for a numbered corpus, `~slug` otherwise. */
  section: string;
  title: string;
  /** The `## N. Parent › ### Na. Child` trail, for a reader placing a hit. */
  headingPath: string;
  /** The Quick Reference line naming this section — the corpus's own per-section summary. */
  gloss: string;
  /** The bolded lead clauses, which is where a rule states itself. */
  rules: string;
  /** The prose, fences stripped. */
  searchBody: string;
  /** The section verbatim, for `knowledge_read`. */
  body: string;
  ordinal: number;
  /** 1-indexed line its heading sits on, and the last line of its block — the span a changed line is resolved through. */
  line: number;
  endLine: number;
  /** Whether the chunk competes in search; false for a heading that only organises its children. */
  searchable: boolean;
}

/** One edge between documents, resolved or not. @public */
export interface Relation {
  from: string;
  kind: "defers" | "cites" | "governs";
  to?: string;
  raw: string;
  /** The ids a citation named more than one of; in memory only, never a column. */
  ambiguous?: readonly string[];
}
