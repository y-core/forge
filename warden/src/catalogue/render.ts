import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { collectFiles } from "../../../src/tooling/gate/checks/source-scan";
import { frontmatter } from "../corpus/chunk";
import { CANON_ROOT } from "../paths";
import type { Tree } from "../types";

interface Row {
  corpus: string;
  tree: string | null;
  path: string;
  title: string;
  description: string;
}

const SCOPE = { canon: "Every document of the fleet canon", all: "Every governing document — the fleet canon, then this repository's own" };

const FOOTNOTE = "\nGenerated — run `warden catalogue --write` after adding, removing or re-describing a document.\n";

const header = (scope: keyof typeof SCOPE): string => `# Catalogue

${SCOPE[scope]}, with the sentence its own frontmatter uses to describe it. This
is the map an agent is handed before it asks anything: pick a document here, then reach its sections
with \`knowledge_outline\`, \`knowledge_search\` or \`warden outline <path>\`.
${scope === "canon" ? FOOTNOTE : ""}`;

const TREE_TITLES: Record<string, string> = { shared: "Shared — every repository, whatever its kind", libs: "Libraries", apps: "Applications" };

const CANON_TITLE = "The fleet canon";

const LOCAL_TITLE = "This repository — its own documents";

const DEPENDENCY_TITLE = "The installed library — advisory, and about the library rather than this repository";

/** The heading each corpus groups under in the served catalogue. */
const GROUPS: Record<string, string> = { project: LOCAL_TITLE, dependency: DEPENDENCY_TITLE };

/** What a rendered catalogue covers. @public */
export interface CatalogueScope {
  /** Also list this repository's own documents, under a heading of their own. */
  local?: boolean;
}

/** Renders the catalogue, canon-only by default. @public */
export function renderCatalogue(db: Database, scope: CatalogueScope = {}): string {
  const local = scope.local === true;
  const where = local ? "" : " WHERE corpus = 'canon'";
  const rows = db.query<Row>(`SELECT corpus, tree, path, title, description FROM source${where} ORDER BY corpus, tree, path`).all();

  const sections: string[] = [header(local ? "all" : "canon")];
  let group: string | null = null;
  for (const row of rows) {
    const title = GROUPS[row.corpus] ?? (local ? CANON_TITLE : (TREE_TITLES[row.tree ?? ""] ?? row.tree ?? "Canon"));
    if (title !== group) {
      group = title;
      sections.push(`\n## ${title}\n`);
    }
    sections.push(`- \`${row.path}\` — ${row.title}: ${row.description}`);
  }
  return `${sections.join("\n")}\n`;
}

/** The committed catalogue, read off the canon on disk rather than out of an index. @public */
export function renderCanon(canonRoot = CANON_ROOT): string {
  const sections: string[] = [header("canon")];
  for (const tree of ["apps", "libs", "shared"] as Tree[]) {
    const files = collectFiles(canonRoot, tree, (name) => name.endsWith(".md")).sort();
    if (files.length === 0) continue;
    sections.push(`\n## ${TREE_TITLES[tree] ?? tree}\n`);
    for (const entry of files) {
      const { title, description } = frontmatter(readFileSync(resolve(canonRoot, entry), "utf-8"));
      sections.push(`- \`${entry.slice(tree.length + 1)}\` — ${title}: ${description}`);
    }
  }
  return `${sections.join("\n")}\n`;
}
