import type { Database } from "bun:sqlite";

interface Row {
  corpus: string;
  tree: string | null;
  path: string;
  title: string;
  description: string;
}

const HEADER = `# Catalogue

Every document of the fleet canon, with the sentence its own frontmatter uses to describe it. This
is the map an agent is handed before it asks anything: pick a document here, then reach its sections
with \`knowledge_outline\`, \`knowledge_search\` or \`warden outline <path>\`.

Generated — run \`warden catalogue --write\` after adding, removing or re-describing a document.
`;

const TREE_TITLES: Record<string, string> = { shared: "Shared — every repository, whatever its kind", libs: "Libraries", apps: "Applications" };

/** Renders the canon catalogue.
 *
 *  **Canon only.** The local half varies per repository, so including it would make a committed
 *  file that changes for reasons the fleet does not share. A consumer gets its own generated in
 *  memory and served as a resource.
 *
 *  Nothing here changes when prose changes without the document set changing — no counts, no
 *  timestamps, no version string — so a drift check reports a real change and never a heartbeat. @public */
export function renderCatalogue(db: Database): string {
  const rows = db.query<Row>("SELECT corpus, tree, path, title, description FROM source WHERE corpus = 'canon' ORDER BY tree, path").all();

  const sections: string[] = [HEADER];
  let tree: string | null = null;
  for (const row of rows) {
    if (row.tree !== tree) {
      tree = row.tree;
      sections.push(`\n## ${TREE_TITLES[tree ?? ""] ?? tree ?? "Canon"}\n`);
    }
    sections.push(`- \`${row.path}\` — ${row.title}: ${row.description}`);
  }
  return `${sections.join("\n")}\n`;
}
