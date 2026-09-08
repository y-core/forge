import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { addCommand, createCommand } from "../../../src/tooling/cli/command";
import { CliError } from "../../../src/tooling/cli/errors";
import type { CommandBase } from "../../../src/tooling/cli/types";
import { renderCatalogue } from "../catalogue/render";
import { parseCorpus, parseId } from "../corpus/ident";
import { changed } from "../impact/git";
import { impact } from "../impact/impact";
import { renderImpact } from "../impact/render";
import { gateIndexPath, indexPath } from "../index/db";
import { openIndex, rebuild } from "../index/open";
import { serveStdio } from "../mcp/server";
import { resolveRepoRoot, WARDEN_ROOT } from "../paths";
import { outline, readSection } from "../search/read";
import { related } from "../search/related";
import { corpusLabel, search } from "../search/search";
import { resolveKind } from "../sync/kind";
import { CORPORA } from "../types";
import { canonVersion } from "../version";
import { createProbeCommand } from "./probe";

const ROOT_FLAG = { type: "string", description: "Repository root (default: derived from warden's install path)" } as const;
const KIND_FLAG = { type: "string", description: "Select the canon tree (libs|apps), overriding package.json's `warden.kind`" } as const;
const GATE_FLAG = { type: "boolean", description: "Use the gate's own index rather than the working one" } as const;
const DEPENDENCY_FLAG = { type: "boolean", description: "Also serve the installed library's consumer-facing documents" } as const;

function context(flags: { root?: string | undefined; kind?: string | undefined; gate?: boolean | undefined; dependency?: boolean | undefined }): {
  root: string;
  kind: "libs" | "apps";
  path: string;
  dependency: boolean;
} {
  const root = resolveRepoRoot(flags.root);
  return {
    root,
    kind: resolveKind(root, flags.kind),
    path: flags.gate === true ? gateIndexPath(root) : indexPath(root),
    dependency: flags.dependency === true,
  };
}

/** Builds the `warden` knowledge commands: `index`, `search`, `read`, `outline`, `related`, `impact`, `probe`. @public */
export function createKnowledgeCommands(parent: CommandBase): void {
  addCommand(
    parent,
    createCommand({
      name: "index",
      description: "Rebuild the knowledge index from disk",
      flags: { root: ROOT_FLAG, kind: KIND_FLAG, gate: GATE_FLAG, dependency: DEPENDENCY_FLAG },
      run: (_args, flags) => {
        const { root, kind, path, dependency } = context(flags);
        const report = rebuild(root, kind, { path, dependency, canonVersion: canonVersion() });
        console.log(
          `indexed ${report.documents} documents, ${report.chunks} chunks, ${report.relations} relations (${report.unresolved} unresolved)`,
        );
        console.log(path);
      },
    }),
  );

  addCommand(
    parent,
    createCommand({
      name: "search",
      description: "Rank the corpus against a query",
      args: { kind: "min", min: 1 },
      flags: {
        root: ROOT_FLAG,
        kind: KIND_FLAG,
        gate: GATE_FLAG,
        dependency: DEPENDENCY_FLAG,
        corpus: { type: "string", description: `Narrow to one of ${CORPORA.join(", ")}` },
        path: { type: "string", description: "Narrow to one directory or one document, matched whole" },
        limit: { type: "string", description: "Maximum hits (default: 10)" },
        scores: { type: "boolean", description: "Print each hit's coverage and BM25 score" },
      },
      run: (args, flags) => {
        const { root, kind, path, dependency } = context(flags);
        // Validated before the index is opened: an unknown corpus reaches SQL as a literal no row
        // carries, and "no section of this corpus covers that" is a real answer here — so a typo
        // would be reported as the corpus having no rule rather than as a typo.
        const corpus = flags.corpus === undefined ? undefined : parseCorpus(flags.corpus);
        if (flags.corpus !== undefined && corpus === undefined) {
          throw new CliError("invalid-args", `--corpus must be one of ${CORPORA.join(", ")}, not "${flags.corpus}"`);
        }
        const knowledge = openIndex(root, kind, { path, dependency, canonVersion: canonVersion() });
        try {
          if (knowledge.advisory !== "") console.error(`! ${knowledge.advisory}`);
          const hits = search(knowledge.db, args.join(" "), {
            ...(corpus === undefined ? {} : { corpus }),
            aliases: knowledge.aliases,
            ...(flags.path === undefined ? {} : { path: flags.path }),
            limit: Number(flags.limit ?? "10"),
          });
          if (hits.length === 0) {
            console.log("no section of this corpus covers that");
            return;
          }
          for (const hit of hits) {
            console.log(
              `${flags.scores === true ? `${hit.coverage.toFixed(2)} ${hit.score.toFixed(4)}  ` : ""}${hit.id}  (${corpusLabel(hit.corpus)})`,
            );
            console.log(`    ${hit.headingPath}`);
            if (hit.gloss !== "") console.log(`    ${hit.gloss}`);
          }
        } finally {
          knowledge.close();
        }
      },
    }),
  );

  addCommand(
    parent,
    createCommand({
      name: "read",
      description: "Print one section by its chunk id",
      args: { kind: "exact", count: 1 },
      flags: {
        root: ROOT_FLAG,
        kind: KIND_FLAG,
        gate: GATE_FLAG,
        dependency: DEPENDENCY_FLAG,
        neighbours: { type: "string", description: "Also print N sections either side" },
      },
      run: (args, flags) => {
        const { root, kind, path, dependency } = context(flags);
        const knowledge = openIndex(root, kind, { path, dependency, canonVersion: canonVersion() });
        try {
          const sections = readSection(knowledge.db, args[0] ?? "", Number(flags.neighbours ?? "0"));
          if (sections.length === 0) throw new CliError("invalid-args", `no section with id "${args[0]}" — run \`warden search\` to find one`);
          for (const section of sections) {
            console.log(`## ${section.section}. ${section.title}   (${section.id} — ${corpusLabel(section.corpus)})`);
            console.log("");
            console.log(section.body);
            console.log("");
          }
        } finally {
          knowledge.close();
        }
      },
    }),
  );

  addCommand(
    parent,
    createCommand({
      name: "outline",
      description: "List every section of one document, so a large file is read one section at a time",
      args: { kind: "exact", count: 1 },
      flags: { root: ROOT_FLAG, kind: KIND_FLAG, gate: GATE_FLAG, dependency: DEPENDENCY_FLAG },
      run: (args, flags) => {
        const { root, kind, path, dependency } = context(flags);
        const knowledge = openIndex(root, kind, { path, dependency, canonVersion: canonVersion() });
        try {
          const entries = outline(knowledge.db, args[0] ?? "");
          if (entries.length === 0) throw new CliError("invalid-args", `no document at "${args[0]}"`);
          // One path can name a document in more than one corpus. The sections arrive grouped, so
          // a header where the group changes is all it takes to say which is which — and a single
          // match gets no header, because there is nothing to tell apart.
          const documentOf = (id: string) => id.slice(0, id.indexOf("#") === -1 ? undefined : id.indexOf("#"));
          const labelled = new Set(entries.map((entry) => documentOf(entry.id))).size > 1;
          let current = "";
          for (const entry of entries) {
            const document = documentOf(entry.id);
            if (labelled && document !== current) {
              current = document;
              console.log(`${entry === entries[0] ? "" : "\n"}${document} — ${corpusLabel(parseId(entry.id)?.corpus ?? "project")}`);
            }
            console.log(`${"  ".repeat(entry.level - 1)}§${entry.section} ${entry.title}${entry.gloss === "" ? "" : ` — ${entry.gloss}`}`);
          }
        } finally {
          knowledge.close();
        }
      },
    }),
  );

  addCommand(
    parent,
    createCommand({
      name: "related",
      description: "List what a section defers to, cites, and is cited by",
      args: { kind: "exact", count: 1 },
      flags: {
        root: ROOT_FLAG,
        kind: KIND_FLAG,
        gate: GATE_FLAG,
        dependency: DEPENDENCY_FLAG,
        depth: { type: "string", description: "Follow edges N levels (default: 1)" },
      },
      run: (args, flags) => {
        const { root, kind, path, dependency } = context(flags);
        const knowledge = openIndex(root, kind, { path, dependency, canonVersion: canonVersion() });
        try {
          const edges = related(knowledge.db, args[0] ?? "", undefined, Number(flags.depth ?? "1"));
          if (edges.length === 0) {
            console.log("no relation");
            return;
          }
          for (const edge of edges) console.log(`${edge.kind.padEnd(10)} ${edge.id ?? `(unresolved) ${edge.raw}`}`);
        } finally {
          knowledge.close();
        }
      },
    }),
  );

  addCommand(
    parent,
    createCommand({
      name: "impact",
      description: "Show which governing sections a ref changed, what depends on them, and what they govern",
      args: { kind: "exact", count: 1 },
      flags: { root: ROOT_FLAG, kind: KIND_FLAG, gate: GATE_FLAG, dependency: DEPENDENCY_FLAG },
      run: (args, flags) => {
        const { root, kind, path, dependency } = context(flags);
        const ref = args[0] ?? "";
        const knowledge = openIndex(root, kind, { path, dependency, canonVersion: canonVersion() });
        try {
          process.stdout.write(renderImpact(impact(knowledge.db, root, knowledge.sources, ref, changed(root, ref))));
        } finally {
          knowledge.close();
        }
      },
    }),
  );

  createProbeCommand(parent);
}

/** Builds the `warden catalogue` command. @public */
export function createCatalogueCommand(parent: CommandBase): void {
  addCommand(
    parent,
    createCommand({
      name: "catalogue",
      description: "Print the canon catalogue, or write it to warden/CATALOGUE.md",
      flags: { root: ROOT_FLAG, kind: KIND_FLAG, write: { type: "boolean", description: "Write the file rather than printing it" } },
      run: (_args, flags) => {
        // No `dependency`: the committed catalogue is the fleet canon's inventory, and this command
        // is what writes it. Indexing an installed library here would cost a build and change nothing.
        const { root, kind, path } = context({ ...flags, gate: false });
        const knowledge = openIndex(root, kind, { path, canonVersion: canonVersion() });
        try {
          const rendered = renderCatalogue(knowledge.db);
          if (flags.write !== true) {
            process.stdout.write(rendered);
            return;
          }
          const file = resolve(WARDEN_ROOT, "CATALOGUE.md");
          writeFileSync(file, rendered, "utf-8");
          console.log(`wrote ${file}`);
        } finally {
          knowledge.close();
        }
      },
    }),
  );
}

/** Builds the `warden serve` command — the stdio MCP server. @public */
export function createServeCommand(parent: CommandBase): void {
  addCommand(
    parent,
    createCommand({
      name: "serve",
      description: "Serve the corpus over MCP on stdio",
      flags: { root: ROOT_FLAG, kind: KIND_FLAG, dependency: DEPENDENCY_FLAG },
      run: async (_args, flags) => {
        await serveStdio({
          ...(flags.root === undefined ? {} : { root: flags.root }),
          ...(flags.kind === undefined ? {} : { kind: flags.kind }),
          dependency: flags.dependency === true,
        });
      },
    }),
  );
}
