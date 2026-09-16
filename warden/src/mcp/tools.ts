import type { Database } from "bun:sqlite";

import { parseCorpus } from "../corpus/ident";
import { changed } from "../impact/git";
import { impact } from "../impact/impact";
import { renderImpact } from "../impact/render";
import type { Knowledge } from "../index/open";
import { outline, readSection } from "../search/read";
import { related } from "../search/related";
import { renderHit } from "../search/render";
import { corpusLabel, search } from "../search/search";
import { CORPORA } from "../types";
import { truncate } from "./truncate";

/** What a host may assume about a tool without calling it, as MCP's `tools/list` returns it.
 *
 *  Every tool here reads and nothing else — `knowledge_impact` shells out to `git diff` and writes
 *  no more than the rest. Saying so is what lets a host auto-approve a call instead of asking, which
 *  is the difference between a question answered in this turn and one answered in the next. @public */
export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint: boolean;
}

/** A tool's declared shape, as MCP's `tools/list` returns it. @public */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
}

const STRING = { type: "string" } as const;

function reading(title: string): ToolAnnotations {
  // The corpus is on disk beside the repository: nothing is fetched, so the world is closed, and the
  // same question asked twice answers the same way.
  return { title, readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
}

/** The five tools, described against the corpus this index actually holds. Parameterised computation
 *  is a tool; addressable content is a resource, and lives in `resources.ts`. @public */
export function knowledgeTools(knowledge: Knowledge): readonly ToolSpec[] {
  const covers = coverage(knowledge.db);
  return [
    {
      name: "knowledge_search",
      annotations: reading("Search the governing corpus"),
      description:
        "Rank the governing corpus against a question. Returns chunk ids of the form `canon:CODE_RULES.md#5c` — pass one to knowledge_read. Each hit carries a coverage figure from 0 to 1: how much of your question that section actually addresses. A question the corpus does not cover returns nothing at all rather than a near miss, so an empty result is an answer — it means no rule here governs what you asked. Hits are drawn from three corpora: the fleet canon, this repository's own documents, and the installed library's consumer-facing documents — the last governs the library rather than this repository, so read it as advice on using the library and never as a rule about where this repository's own code goes. Search before inferring any architectural rule." +
        covers,
      inputSchema: {
        type: "object",
        properties: {
          query: { ...STRING, description: "The question, in the words you would ask a colleague" },
          corpus: {
            ...STRING,
            enum: [...CORPORA],
            description: "`canon` for the fleet's law, `project` for this repository's own, `dependency` for the installed library's",
          },
          path: { ...STRING, description: "One directory or one document, matched whole — `docs` or `docs/NAMESPACES.md`, never a pattern" },
          limit: { type: "number", description: "Maximum hits (default 10)" },
        },
        required: ["query"],
      },
    },
    {
      name: "knowledge_read",
      annotations: reading("Read one section whole"),
      description:
        "Read one section whole, by the chunk id knowledge_search returned. A section that only heads its subsections comes back with them, so a `§N` never has to be re-read as `§Na`. `neighbours` also returns the sections either side, which is usually where the rule that scopes it lives.",
      inputSchema: {
        type: "object",
        properties: {
          id: { ...STRING, description: "A chunk id, e.g. `canon:CODE_RULES.md#5c`" },
          neighbours: { type: "number", description: "Also return N sections either side (default 0)" },
        },
        required: ["id"],
      },
    },
    {
      name: "knowledge_outline",
      annotations: reading("Outline one document's sections"),
      description:
        'List every section of one document with its one-line summary — the answer to "this file is 62 KB and I need one section". Read the outline, then knowledge_read the section you want.',
      inputSchema: {
        type: "object",
        properties: { path: { ...STRING, description: "A document path, e.g. `docs/NAMESPACES.md`" } },
        required: ["path"],
      },
    },
    {
      name: "knowledge_related",
      annotations: reading("Trace what a section binds and what binds it"),
      description:
        "What a section defers to, what it cites, what cites it, and which published subpaths its prose governs. Ask this before changing a rule: the inbound edges are what else depends on it, and the `governs` edges are the code it binds.",
      inputSchema: {
        type: "object",
        properties: {
          id: { ...STRING, description: "A chunk id, or a document id without the `#section`" },
          kinds: {
            type: "array",
            items: STRING,
            description: "Filter to `defers`, `cites`, `governs`, or any of them with `-by` for the inbound direction",
          },
          depth: { type: "number", description: "Follow edges N levels (default 1)" },
        },
        required: ["id"],
      },
    },
    {
      name: "knowledge_impact",
      annotations: reading("Report the blast radius of a documentation change"),
      description:
        "Given a git ref, which governing sections a diff changed, what else depends on each of them, and which published subpaths each one governs. The blast radius of a documentation change, in the direction a reviewer reads it.",
      inputSchema: {
        type: "object",
        properties: { ref: { ...STRING, description: "A git ref to diff against, e.g. `HEAD~1` or `main`" } },
        required: ["ref"],
      },
    },
  ];
}

/** How wide the document list may grow before it is cut short. A tool description is paid for on
 *  every `tools/list`, so the scope it buys has to stay one line. */
const COVERS_BUDGET = 260;

const CORPUS_NOUNS: Record<string, string> = { canon: "canon", project: "project", dependency: "library" };

/** The one line that tells a model what this corpus is about before it spends a turn finding out.
 *  Filenames only — the catalogue resource is where the titles and the descriptions live. */
function coverage(db: Database): string {
  const rows = db.query<{ corpus: string; path: string }>("SELECT corpus, path FROM source ORDER BY corpus, path").all();
  if (rows.length === 0) return "";

  const names = [...new Set(rows.map((row) => row.path.split("/").at(-1) ?? row.path))];
  const kept: string[] = [];
  let width = 0;
  for (const name of names) {
    width += name.length + 2;
    if (width > COVERS_BUDGET) break;
    kept.push(name);
  }

  const counts = CORPORA.map((corpus) => ({ corpus, count: rows.filter((row) => row.corpus === corpus).length }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.count} ${CORPUS_NOUNS[entry.corpus] ?? entry.corpus}`);

  return `\n\nCovers: ${kept.join(", ")}${kept.length < names.length ? ", …" : ""} (${counts.join(", ")} documents).`;
}

/** What a tool call returns, in MCP's content shape. @public */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

function failure(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** `limit` reaches SQL and the final slice unchecked otherwise, and it is the only number a caller
 *  sets that bounds how much this server reads. */
function boundedLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 10;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

/** Runs one tool against an open index. @public */
export function callTool(knowledge: Knowledge, name: string, args: Record<string, unknown>): ToolResult {
  const advisory = knowledge.advisory === "" ? "" : `! ${knowledge.advisory}\n\n`;

  switch (name) {
    case "knowledge_search": {
      const query = typeof args.query === "string" ? args.query : "";
      if (query.trim() === "") return failure("knowledge_search needs a `query`");
      // A misspelled corpus reaches SQL as a literal matching no row, and this tool's own contract
      // is that an empty result means nothing here governs the question. Refused rather than served.
      const corpus = typeof args.corpus === "string" ? parseCorpus(args.corpus) : undefined;
      if (typeof args.corpus === "string" && corpus === undefined) {
        return failure(`knowledge_search: \`corpus\` must be one of ${CORPORA.join(", ")}, not "${args.corpus}"`);
      }
      const hits = search(knowledge.db, query, {
        ...(corpus === undefined ? {} : { corpus }),
        aliases: knowledge.aliases,
        ...(typeof args.path === "string" ? { path: args.path } : {}),
        limit: boundedLimit(args.limit),
        excerpt: true,
      });
      if (hits.length === 0) {
        // Named as a property of the corpus, not of the query. An agent told only "no match" retries
        // with synonyms; one told the corpus does not cover this stops and says so, which is the
        // whole point of refusing rather than offering the best of a bad set.
        return text(`${advisory}No section of this corpus covers "${query}". Nothing here governs it — do not infer a rule from a near miss.`);
      }
      // Capped like `knowledge_read`: `limit` reaches 50 and every hit now carries a line of its
      // own text, so an unbounded search response is no longer the small thing it was.
      return text(advisory + truncate(hits.map((hit) => renderHit(hit)).join("\n\n"), hits[0]?.path ?? query));
    }

    case "knowledge_read": {
      const id = typeof args.id === "string" ? args.id : "";
      const sections = readSection(knowledge.db, id, typeof args.neighbours === "number" ? args.neighbours : 0);
      if (sections.length === 0) return failure(`No section with id "${id}". Run knowledge_search to find one.`);
      const body = sections
        .map((section) => `## ${section.section}. ${section.title}   (${section.id} — ${corpusLabel(section.corpus)})\n\n${section.body}`)
        .join("\n\n---\n\n");
      return text(advisory + truncate(body, sections[0]?.path ?? id));
    }

    case "knowledge_outline": {
      const path = typeof args.path === "string" ? args.path : "";
      const entries = outline(knowledge.db, path);
      if (entries.length === 0) return failure(`No document at "${path}".`);
      return text(
        advisory +
          entries
            .map(
              (entry) =>
                `${"  ".repeat(entry.level - 1)}§${entry.section} ${entry.title}${entry.gloss === "" ? "" : ` — ${entry.gloss}`}\n${"  ".repeat(entry.level - 1)}  ${entry.id}`,
            )
            .join("\n"),
      );
    }

    case "knowledge_related": {
      const id = typeof args.id === "string" ? args.id : "";
      const kinds = Array.isArray(args.kinds) ? args.kinds.filter((kind): kind is string => typeof kind === "string") : undefined;
      const edges = related(knowledge.db, id, kinds, typeof args.depth === "number" ? args.depth : 1);
      if (edges.length === 0) return text(`${advisory}No relation from or to "${id}".`);
      return text(advisory + edges.map((edge) => `${edge.kind.padEnd(10)} ${edge.id ?? `(unresolved) ${edge.raw}`}`).join("\n"));
    }

    case "knowledge_impact": {
      const ref = typeof args.ref === "string" ? args.ref : "";
      if (ref === "") return failure("knowledge_impact needs a git ref.");
      try {
        const report = impact(knowledge.db, knowledge.root, knowledge.sources, ref, changed(knowledge.root, ref));
        return text(advisory + renderImpact(report));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    }

    default:
      return failure(`Unknown tool "${name}".`);
  }
}
