import type { Database } from "bun:sqlite";

import { discover } from "../corpus/source";
import type { SourceDoc, Tree } from "../types";
import { build, type BuildReport } from "./build";
import { indexPath, openDatabase } from "./db";
import { advisory, freshness } from "./freshness";

/** An open index, its documents, and one line saying whether it is behind them. @public */
export interface Knowledge {
  db: Database;
  sources: SourceDoc[];
  /** Empty when the index is current; otherwise the line a caller renders above its results. */
  advisory: string;
  close(): void;
}

/** How many changed documents are still worth refreshing in place rather than rebuilding whole. */
const INCREMENTAL_LIMIT = 10;

/** Opens the index, building or refreshing it as needed.
 *
 *  **An absent index is never an error.** A full build of this corpus is well under a second, so
 *  refusing would only teach a reader to run `warden index` before every question. A stale one is
 *  not an error either: the paths it returns are still right, so it answers, says it is behind, and
 *  refreshes the changed documents when there are few enough for that to be the cheaper answer. @public */
export function openIndex(
  root: string,
  kind: Tree,
  options: { path?: string; canonVersion?: string; canonRoot?: string; docsDir?: string } = {},
): Knowledge {
  const sources = discover(root, kind, {
    ...(options.canonRoot === undefined ? {} : { canonRoot: options.canonRoot }),
    ...(options.docsDir === undefined ? {} : { docsDir: options.docsDir }),
  });
  const canonVersion = options.canonVersion ?? "unknown";
  const db = openDatabase(options.path ?? indexPath(root));

  const state = freshness(db, sources, canonVersion);
  let line = "";
  if (!state.fresh) {
    if (state.rebuild || state.stale.length > INCREMENTAL_LIMIT) build(db, sources, canonVersion);
    else {
      // Few enough to be worth saying what changed before fixing it, so a reader sees why the
      // answer they just got may have been a beat behind.
      line = advisory(state);
      build(db, sources, canonVersion);
    }
  }

  return { db, sources, advisory: line, close: () => db.close() };
}

/** Rebuilds the index from disk unconditionally. @public */
export function rebuild(
  root: string,
  kind: Tree,
  options: { path?: string; canonVersion?: string; canonRoot?: string; docsDir?: string } = {},
): BuildReport {
  const sources = discover(root, kind, {
    ...(options.canonRoot === undefined ? {} : { canonRoot: options.canonRoot }),
    ...(options.docsDir === undefined ? {} : { docsDir: options.docsDir }),
  });
  const db = openDatabase(options.path ?? indexPath(root));
  try {
    return build(db, sources, options.canonVersion ?? "unknown");
  } finally {
    db.close();
  }
}
