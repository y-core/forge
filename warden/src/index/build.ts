import type { Database } from "bun:sqlite";
import { readFileSync, statSync } from "node:fs";

import { linkDefinitions, stripFences } from "../checks/docs";
import { chunkDocument, frontmatter } from "../corpus/chunk";
import { fnv1a } from "../corpus/hash";
import { headerOf, relationsOf } from "../corpus/relate";
import type { Chunk, Relation, SourceDoc } from "../types";
import { stampVersions } from "./db";

/** What one build did, for a caller reporting it. @public */
export interface BuildReport {
  documents: number;
  chunks: number;
  relations: number;
  unresolved: number;
  /** Citations naming more than one indexed document, each with the ids it named. */
  ambiguous: readonly { from: string; raw: string; ids: readonly string[] }[];
}

interface Loaded {
  doc: SourceDoc;
  title: string;
  description: string;
  chunks: Chunk[];
  relations: Relation[];
  size: number;
  mtime: number;
  hash: string;
}

/** Each reference id's destination, which is where a reference-style citation keeps its path. */
function destinations(source: string): Map<string, string> {
  return new Map([...linkDefinitions(stripFences(source))].map(([id, definition]) => [id, definition.destination]));
}

/** Reads and parses every document, resolving relations against the whole set. @public */
export function load(sources: readonly SourceDoc[], packageName?: string): Loaded[] {
  return sources.map((doc) => {
    const source = readFileSync(doc.file, "utf-8");
    const stat = statSync(doc.file) as { size: number; mtimeMs?: number };
    const { title, description } = frontmatter(source);
    const chunks = chunkDocument(doc, source);
    return {
      doc,
      title: title === "" ? doc.path : title,
      description,
      chunks,
      relations: relationsOf(doc, chunks, headerOf(source), sources, packageName, destinations(source)),
      size: stat.size,
      mtime: stat.mtimeMs ?? 0,
      hash: fnv1a(source),
    };
  });
}

/** Replaces the whole index from `sources`, in one transaction. @public */
export function build(db: Database, sources: readonly SourceDoc[], canonVersion: string, packageName?: string): BuildReport {
  const loaded = load(sources, packageName);

  const write = db.transaction(() => {
    db.run("DELETE FROM relation");
    // An external-content FTS table is emptied through its own command table: a plain
    // `DELETE FROM chunk_fts` is accepted and leaves the index carrying its old terms.
    db.run("INSERT INTO chunk_fts (chunk_fts) VALUES ('delete-all')");
    db.run("DELETE FROM chunk");
    db.run("DELETE FROM source");

    const insertSource = db.prepare(
      "INSERT INTO source (corpus, tree, path, title, description, weight, size, mtime, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    );
    const insertChunk = db.prepare(
      "INSERT INTO chunk (id, source_id, section, title, heading_path, gloss, rules, body, ordinal, searchable, line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING rowid",
    );
    const insertSearch = db.prepare("INSERT INTO chunk_fts (rowid, title, heading_path, gloss, rules, search_body) VALUES (?, ?, ?, ?, ?, ?)");
    const insertRelation = db.prepare("INSERT INTO relation (from_id, kind, to_id, raw) VALUES (?, ?, ?, ?)");

    for (const entry of loaded) {
      const { doc } = entry;
      const row = insertSource.get(
        doc.corpus,
        doc.tree ?? null,
        doc.path,
        entry.title,
        entry.description,
        doc.weight,
        entry.size,
        entry.mtime,
        entry.hash,
      ) as { id: number } | null;
      const sourceId = row?.id ?? 0;
      for (const chunk of entry.chunks) {
        const inserted = insertChunk.get(
          chunk.id,
          sourceId,
          chunk.section,
          chunk.title,
          chunk.headingPath,
          chunk.gloss,
          chunk.rules,
          chunk.body,
          chunk.ordinal,
          chunk.searchable ? 1 : 0,
          chunk.line,
          chunk.endLine,
        ) as { rowid: number } | null;
        // Written from the chunk in hand rather than selected back out of `chunk`, which is what
        // lets the content table drop `search_body` entirely.
        if (chunk.searchable) {
          insertSearch.run(inserted?.rowid ?? 0, chunk.title, chunk.headingPath, chunk.gloss, chunk.rules, chunk.searchBody);
        }
      }
      for (const relation of entry.relations) insertRelation.run(relation.from, relation.kind, relation.to ?? null, relation.raw);
    }

    stampVersions(db, canonVersion);
  });

  write();

  const relations = loaded.flatMap((entry) => entry.relations);
  return {
    documents: loaded.length,
    chunks: loaded.reduce((total, entry) => total + entry.chunks.length, 0),
    relations: relations.length,
    unresolved: relations.filter((relation) => relation.to === undefined).length,
    ambiguous: relations
      .filter((relation) => relation.ambiguous !== undefined)
      .map((relation) => ({ from: relation.from, raw: relation.raw, ids: relation.ambiguous ?? [] })),
  };
}
