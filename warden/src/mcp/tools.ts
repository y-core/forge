import type { Knowledge } from "../index/open";
import { outline, readSection } from "../search/read";
import { related } from "../search/related";
import { corpusLabel, search } from "../search/search";

/** A tool's declared shape, as MCP's `tools/list` returns it. @public */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const STRING = { type: "string" } as const;

/** The four tools. Parameterised computation is a tool; addressable content is a resource, and
 *  lives in `resources.ts`. @public */
export const TOOLS: readonly ToolSpec[] = [
  {
    name: "knowledge_search",
    description:
      "Rank the governing corpus against a question. Returns chunk ids of the form `canon:CODE_RULES.md#5c` — pass one to knowledge_read. Each hit carries a coverage figure from 0 to 1: how much of your question that section actually addresses. A question the corpus does not cover returns nothing at all rather than a near miss, so an empty result is an answer — it means no rule here governs what you asked. Search before inferring any architectural rule.",
    inputSchema: {
      type: "object",
      properties: {
        query: { ...STRING, description: "The question, in the words you would ask a colleague" },
        corpus: { ...STRING, enum: ["canon", "project"], description: "`canon` for the fleet's law, `project` for this repository's own" },
        path: { ...STRING, description: "One directory or one document, matched whole — `docs` or `docs/NAMESPACES.md`, never a pattern" },
        limit: { type: "number", description: "Maximum hits (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "knowledge_read",
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
    description:
      "What a section defers to, what it cites, and what cites it. Ask this before changing a rule: the inbound edges are what else depends on it.",
    inputSchema: {
      type: "object",
      properties: {
        id: { ...STRING, description: "A chunk id, or a document id without the `#section`" },
        kinds: { type: "array", items: STRING, description: "Filter to `defers`, `cites`, `defers-by` or `cites-by`" },
        depth: { type: "number", description: "Follow edges N levels (default 1)" },
      },
      required: ["id"],
    },
  },
];

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

/** Runs one tool against an open index. @public */
export function callTool(knowledge: Knowledge, name: string, args: Record<string, unknown>): ToolResult {
  const advisory = knowledge.advisory === "" ? "" : `! ${knowledge.advisory}\n\n`;

  switch (name) {
    case "knowledge_search": {
      const query = typeof args.query === "string" ? args.query : "";
      if (query.trim() === "") return failure("knowledge_search needs a `query`");
      const hits = search(knowledge.db, query, {
        ...(typeof args.corpus === "string" ? { corpus: args.corpus } : {}),
        ...(typeof args.path === "string" ? { path: args.path } : {}),
        limit: typeof args.limit === "number" ? args.limit : 10,
      });
      if (hits.length === 0) {
        // Named as a property of the corpus, not of the query. An agent told only "no match" retries
        // with synonyms; one told the corpus does not cover this stops and says so, which is the
        // whole point of refusing rather than offering the best of a bad set.
        return text(`${advisory}No section of this corpus covers "${query}". Nothing here governs it — do not infer a rule from a near miss.`);
      }
      return text(
        advisory +
          hits
            .map(
              (hit) =>
                `${hit.id}  (${hit.coverage.toFixed(2)}, ${corpusLabel(hit.corpus)})\n  ${hit.headingPath}${hit.gloss === "" ? "" : `\n  ${hit.gloss}`}`,
            )
            .join("\n\n"),
      );
    }

    case "knowledge_read": {
      const id = typeof args.id === "string" ? args.id : "";
      const sections = readSection(knowledge.db, id, typeof args.neighbours === "number" ? args.neighbours : 0);
      if (sections.length === 0) return failure(`No section with id "${id}". Run knowledge_search to find one.`);
      return text(
        advisory +
          sections
            .map((section) => `## ${section.section}. ${section.title}   (${section.id} — ${corpusLabel(section.corpus)})\n\n${section.body}`)
            .join("\n\n---\n\n"),
      );
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

    default:
      return failure(`Unknown tool "${name}".`);
  }
}
