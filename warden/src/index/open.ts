import type { Database } from "bun:sqlite";

import { type DependencyOptions, dependencyRootOf } from "../corpus/dependency";
import { discover } from "../corpus/source";
import { packageNameOf } from "../paths";
import { type AliasTable, aliasesFor } from "../search/aliases";
import type { SourceDoc, Tree } from "../types";
import { build, type BuildReport } from "./build";
import { indexPath, openDatabase } from "./db";
import { advisory, freshness } from "./freshness";

/** An open index, its documents, and one line saying whether it is behind them. @public */
export interface Knowledge {
  db: Database;
  /** The repository the index was built from — what a caller needs to reach the tree behind it. */
  root: string;
  sources: SourceDoc[];
  /** The bridge table this repository's tree earns, resolved once rather than per query. */
  aliases: AliasTable;
  /** Empty when the index is current; otherwise the line a caller renders above its results. */
  advisory: string;
  /** Re-reads the corpus and refreshes the index if it has moved on. */
  refresh(): void;
  close(): void;
}

/** Options every entry point here shares. @public */
export interface OpenOptions extends DependencyOptions {
  path?: string;
  canonVersion?: string;
  canonRoot?: string;
  docsDir?: string;
}

function sourcesOf(root: string, kind: Tree, options: OpenOptions): SourceDoc[] {
  const dependencyRoot = dependencyRootOf(options, root);
  return discover(root, kind, {
    ...(options.canonRoot === undefined ? {} : { canonRoot: options.canonRoot }),
    ...(options.docsDir === undefined ? {} : { docsDir: options.docsDir }),
    ...(dependencyRoot === undefined ? {} : { dependencyRoot }),
  });
}

/** Opens the index, building it if it is absent and refreshing it if it is behind.
 *
 *  **An absent index is never an error.** A full build of this corpus is well under a second, so
 *  refusing would only teach a reader to run `warden index` before every question.
 *
 *  **Freshness belongs to `refresh`, not to opening.** A long-lived caller — the MCP server — holds
 *  one handle across many questions while the documents underneath it are being edited, so checking
 *  once at open would answer every later question from the corpus as it stood at startup. @public */
export function openIndex(root: string, kind: Tree, options: OpenOptions = {}): Knowledge {
  const canonVersion = options.canonVersion ?? "unknown";
  const db = openDatabase(options.path ?? indexPath(root));

  const knowledge: Knowledge = {
    db,
    root,
    sources: [],
    aliases: aliasesFor(kind),
    advisory: "",
    refresh: () => {
      const sources = sourcesOf(root, kind, options);
      knowledge.sources = sources;

      const state = freshness(db, sources, canonVersion);
      if (state.fresh) {
        knowledge.advisory = "";
        return;
      }

      // A rebuild is whole rather than per-document: it runs only when something actually changed,
      // and this corpus rebuilds in well under a second, which is cheaper than the bookkeeping an
      // external-content FTS table needs to have rows deleted from it correctly.
      try {
        build(db, sources, canonVersion, packageNameOf(root));
        knowledge.advisory = "";
      } catch (error) {
        // The index is behind and could not be brought forward. Answering from it is still better
        // than refusing — the sections it names have not moved — so say so and serve it.
        knowledge.advisory = `${advisory(state)}; the refresh failed — ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    close: () => db.close(),
  };

  knowledge.refresh();
  return knowledge;
}

/** Rebuilds the index from disk unconditionally. @public */
export function rebuild(root: string, kind: Tree, options: OpenOptions = {}): BuildReport {
  const sources = sourcesOf(root, kind, options);
  const db = openDatabase(options.path ?? indexPath(root));
  try {
    const report = build(db, sources, options.canonVersion ?? "unknown", packageNameOf(root));
    // A build that empties the tables frees pages without returning them to the OS, so an index
    // carried across a schema change keeps the old file's size. `rebuild` owns its handle and runs
    // outside any transaction, which is what `VACUUM` needs — `refresh()` is the server's hot path
    // and deliberately does not do this.
    db.run("VACUUM");
    return report;
  } finally {
    db.close();
  }
}
