import type { Database } from "bun:sqlite";
import { readFileSync, statSync } from "node:fs";

import { fnv1a } from "../corpus/hash";
import type { SourceDoc } from "../types";
import { versionsMatch } from "./db";

/** What a freshness check found: `stale` names the paths that changed, `rebuild` says the whole index has to go. @public */
export interface Freshness {
  fresh: boolean;
  rebuild: boolean;
  stale: string[];
  reason: string;
}

interface Row {
  corpus: string;
  tree: string | null;
  path: string;
  size: number;
  mtime: number;
  hash: string;
}

/** Whether the index is current, cheapest gate first: the version, then `size`/`mtimeMs`, then a content hash. @public */
export function freshness(db: Database, sources: readonly SourceDoc[], canonVersion: string): Freshness {
  if (!versionsMatch(db, canonVersion)) {
    return { fresh: false, rebuild: true, stale: [], reason: "the schema, the indexer or the canon version changed" };
  }

  const rows = db.query<Row>("SELECT corpus, tree, path, size, mtime, hash FROM source").all();
  const indexed = new Map(rows.map((row) => [`${row.corpus}/${row.tree ?? ""}/${row.path}`, row]));

  if (indexed.size !== sources.length) {
    return { fresh: false, rebuild: true, stale: [], reason: `the document set changed — ${indexed.size} indexed, ${sources.length} on disk` };
  }

  const stale: string[] = [];
  for (const doc of sources) {
    const row = indexed.get(`${doc.corpus}/${doc.tree ?? ""}/${doc.path}`);
    if (row === undefined) {
      return { fresh: false, rebuild: true, stale: [], reason: `\`${doc.path}\` is on disk and not in the index` };
    }
    const stat = statSync(doc.file) as { size: number; mtimeMs?: number };
    if (stat.size === row.size && (stat.mtimeMs ?? 0) === row.mtime) continue;
    if (fnv1a(readFileSync(doc.file, "utf-8")) === row.hash) continue;
    stale.push(doc.path);
  }

  return stale.length === 0
    ? { fresh: true, rebuild: false, stale: [], reason: "" }
    : { fresh: false, rebuild: false, stale, reason: `${stale.length} document${stale.length === 1 ? "" : "s"} changed` };
}

/** The advisory a search prints over an index it could not bring forward. @public */
export function advisory(state: Freshness): string {
  if (state.fresh) return "";
  const detail = state.stale.length > 0 ? `: ${state.stale.slice(0, 5).join(", ")}${state.stale.length > 5 ? ", …" : ""}` : "";
  return `index is behind the corpus — ${state.reason}${detail}`;
}
