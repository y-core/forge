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

/** Opens the index, building it if it is absent and refreshing it if it is behind. @public */
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

      // A rebuild is whole rather than per-document: an external-content FTS table needs careful
      // bookkeeping to have rows deleted from it correctly.
      try {
        build(db, sources, canonVersion, packageNameOf(root));
        knowledge.advisory = "";
      } catch (error) {
        // The index is behind and could not be brought forward; the sections it names have not
        // moved, so it is served with the failure stated.
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
    // A build that empties the tables frees pages without returning them to the OS. `VACUUM` needs
    // a handle outside any transaction, which `refresh()` on the server's hot path does not have.
    db.run("VACUUM");
    return report;
  } finally {
    db.close();
  }
}
