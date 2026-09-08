import type { Database } from "bun:sqlite";

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

/** The heading each corpus groups under in the served catalogue. Keyed rather than conditional: a
 *  `row.corpus === "project" ? … : …` put every corpus that was not `project` under the fleet
 *  canon's heading, which is the first thing an agent reads. */
const GROUPS: Record<string, string> = { project: LOCAL_TITLE, dependency: DEPENDENCY_TITLE };

/** What a rendered catalogue covers. @public */
export interface CatalogueScope {
  /** Also list this repository's own documents, under a heading of their own. */
  local?: boolean;
}

/** Renders the catalogue, canon-only by default.
 *
 *  **The committed file is canon-only, and the served resource is not.** The local half varies per
 *  repository, so a committed file carrying it would change for reasons the fleet does not share —
 *  while a consumer reading the resource is asking what governs _it_, and canon alone answers half
 *  the question. The default keeps `warden catalogue --write` byte-stable; the MCP resource asks
 *  for both.
 *
 *  Nothing here changes when prose changes without the document set changing — no counts, no
 *  timestamps, no version string — so a drift check reports a real change and never a heartbeat.
 *
 *  **Only the committed file names a tree.** It is forge's own inventory, and forge houses all three
 *  trees on disk; a consumer's index holds `shared` plus its own kind, so the distinction is one it
 *  could not act on and the served resource groups the canon whole. @public */
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
