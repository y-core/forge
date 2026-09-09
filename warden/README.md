---
title: Warden — the Governing Corpus and Its Machinery
description: "The fleet canon, the sync that keeps a repository in step with it, the knowledge index that serves it, and the gate checks that hold it true."
---

# warden

The fleet's governing corpus, and the machinery that keeps a repository in step with it.

`warden/` sits outside `src/` because it is not a runtime namespace and is never Worker-reachable.
The import rule runs one way: warden may import up into `src/tooling/`, and nothing in `src/` may
import warden. `buildTimeBoundaryStep` enforces it.

## Who Warden Is For

**Warden serves the repositories that already depend on `@y-core/forge`, and only those.** It
ships inside forge rather than as its own package, so adopting it means taking forge whole. For a
Workers app that is free — forge is already a dependency. For a repository that does not consume
forge, it is a large dependency bought for a SQLite index and a CLI, and the exchange is not worth
it.

A repository outside that set keeps its governing documents as plain markdown it owns, reached by
reading: a directory listing picks the document, its `## 0. Quick Reference` picks the section. Such a repository may still follow the canon's _shape_ —
numbered sections, a Quick Reference, the single-home rule — without being served by warden.
`devctl` is the standing example: single-purpose, in maintenance, and deliberately a non-consumer.

Two consequences worth stating. A non-consumer gets no `warden sync`, so its agent definitions and
slash commands are its own to maintain, and they will drift from the fleet's unless someone
reconciles them. And `docs/` is only warden's corpus convention where warden is in use — a
repository already using that directory name for something else is not obliged to rename it.

## Layout

| Path | What it holds |
| --- | --- |
| `canon/shared/` | The documents both kinds share, byte-identical |
| `canon/libs/` | The library corpus |
| `canon/apps/` | The application corpus |
| `claude/agents/` | Agent definitions, one tree per kind — the source a sync copies from |
| `claude/commands/` | Slash commands, shared by both kinds |
| `claude/seed/` | `CLAUDE.md`, `AGENTS.md` and `settings.local.json`, written only when absent |
| `share/` | Example editor configuration `warden show` writes to stdout |
| `src/` | Every module — the command, the sync, the checks, the index, the MCP server |

**The canon is never copied into a consumer.** It is read from the installed
`node_modules/@y-core/forge/warden/canon/`. A sync writes `claude/` and nothing else, so a rule can
never be edited in a consumer and silently reverted by the next sync.

## Commands

Every command takes `--root=<path>` to name the repository it acts on; the default is derived from
warden's own install path. Every command that reads the canon takes `--kind=<libs|apps>` to override
the tree selection.

### Keeping a repository in step

```bash
warden sync                  # replace .claude/agents and .claude/commands
warden sync --init           # also seed CLAUDE.md, AGENTS.md and settings.local.json if absent
warden sync --check          # report drift and exit 1 if any, writing nothing

warden natives               # place the editor architecture's prebuilt native bindings
  --arch=<platform-arch>     # the target to fetch, overriding this machine's

warden show --zed            # write the Zed user settings to stdout, to merge by hand
```

A sync deletes `.claude/agents/` wholesale. A repository-local agent added since the last sync is
lost — keep one outside that directory.

### Reading the corpus

These are the terminal form of the same path the warden MCP tools take, through the same index.

```bash
warden index                 # rebuild the knowledge index from disk
warden search <question>     # rank the corpus; prints a chunk id per hit
  --corpus=<canon|project>   # narrow to the fleet's law, or this repository's own
  --path=<dir|document>      # narrow to one directory or one document, matched whole
  --limit=<n>                # maximum hits (default: 10)
  --scores                   # print each hit's coverage and BM25 score

warden read <id>             # print one section whole, by the chunk id search returned
  --neighbours=<n>           # also print N sections either side

warden outline <path>        # list every section of one document with its one-line summary
warden related <id>          # what a section defers to, cites, is cited by, and governs
  --depth=<n>                # follow edges N levels (default: 1)

warden impact <ref>          # which sections a ref changed, what depends on them, what they govern

warden catalogue             # print the canon catalogue
warden catalogue --write     # write it to <root>/warden/CATALOGUE.md instead

warden serve                 # serve the corpus over MCP on stdio
```

**Only the canon's home repository commits a catalogue.** `warden catalogue` renders the fleet
canon and nothing repository-specific, so the file is byte-identical wherever it is written —
forge owns it, and `wardenStep` asserts it only where `catalogue` is configured. Elsewhere the
live `knowledge://catalogue` resource is the copy, rendered per repository and stored nowhere.
`--write` writes under the root it was given and refuses a target inside `node_modules`.

Search, read, outline and related also take `--gate`, which reads the gate's own index rather than
the working one.

**An empty search result is an answer.** Search refuses a question the corpus does not cover rather
than returning its ten least-bad matches, so nothing governs a subject that comes back empty.

**A chunk id names the corpus and the path.** `canon:CODE_RULES.md#5c` is the fleet's law;
`project:docs/TESTING.md#3b` is this repository's own. A filename and a section number exist in both
corpora, so the prefix is what says which one a hit came from.

## Published Surface

Four subpaths of `@y-core/forge` are warden's, and each is a barrel whose table below is held
against it by the `validate-readme-exports` gate step.

**The root subpath is the whole of warden, and nothing consumes it but forge's own command.**
`import { createWardenCommands } from "@y-core/forge/warden"` reaches every module — the corpus
parser, the sync, the index and the CLI alike — which is what `warden/src/bin.ts` needs and more
than any consumer should take. A consuming repository imports the four narrow subpaths instead: a
gate that pulls the root barrel for `docsStep` drags the MCP server and the SQLite index in behind
it.

## `@y-core/forge/warden/checks`

> Import path: `@y-core/forge/warden/checks` → `warden/src/checks/mod.ts`

The gate checks warden owns, each a pure function from a config to a result, plus the parsers they
are built out of.

### Exports

| Symbol | Kind | Summary |
| --- | --- | --- |
| `checkDocs` | function | Holds the governing documents against the subpath catalog, the numbering, the frontmatter and the citations. |
| `DocsCheckConfig` | type | What `checkDocs` needs: the root, the package name, the exports map, and the extra directories to hold. |
| `DocKind` | type | Which canon tree a directory's documents are read as — `shared`, `libs` or `apps`. |
| `ExtraDir` | type | One directory outside `docs/` to hold, with the kind its citations resolve against, and whether its documents are numbered governing prose. |
| `FrontmatterRule` | type | One extra frontmatter key a directory's documents must carry, and the values it may take. |
| `parseSections` | function | A document's numbered sections, with the line each opens on. |
| `stripFences` | function | The prose of a document with every fenced block removed, so a rule never fires on a code sample. |
| `validateFrontmatter` | function | Holds a document's frontmatter to `title`, `description` and whichever extra keys the caller requires. |
| `validateNoRot` | function | Reports historical phrasing — a governing document carries no history. |
| `findSubpathCitations` | function | Every published subpath a markdown source cites. |
| `SubpathCitation` | type | One cited subpath, and the line it was cited on. |
| `quickReference` | function | The `## 0. Quick Reference` block of a document, parsed into one entry per section. |
| `uncitedSubpaths` | function | The published subpaths no governing document cites. |
| `checkReadmeExports` | function | Holds a README's per-subpath export tables against the barrels they document. |
| `ReadmeExportsCheckConfig` | type | What `checkReadmeExports` needs: the root, the READMEs, and the subpaths exempt from a table. |
| `discoverReadmes` | function | Every README under the walked sources carrying at least one `> Import path:` anchor. |
| `checkChangelog` | function | Holds the changelog's headings against the current package version. |
| `validateChangelog` | function | The changelog rules alone, over a parsed source. |
| `ChangelogCheckConfig` | type | What `checkChangelog` needs: the root and the package version. |
| `checkDesign` | function | Holds the design corpus against the tree it governs. |
| `DesignCheckConfig` | type | What `checkDesign` needs: the root, the package name, and the corpus layout. |

## `@y-core/forge/warden/steps`

> Import path: `@y-core/forge/warden/steps` → `warden/src/steps.ts`

The same checks as gate steps, ready to drop into a repository's `config/steps.ts`. Each label is
fixed, because a label is the `--only` token a developer types.

### Exports

| Symbol | Kind | Summary |
| --- | --- | --- |
| `docsStep` | function | `validate-docs` — the governing documents against the subpaths they must cite. |
| `readmeExportsStep` | function | `validate-readme-exports` — a README's export tables against the barrels. |
| `changelogStep` | function | `validate-changelog` — the changelog against the package version. Defaults to the `full` tier. |
| `designStep` | function | `validate-design` — the design corpus against the tree it governs. |
| `wardenStep` | function | `warden:index` — rebuilds the knowledge index and asserts what retrieval depends on. Its `catalogue` option is opt-in and belongs to the canon's home repository alone. |
| `wardenQueriesStep` | function | `warden:queries` — the golden retrieval set against a freshly built index. |
| `duplicatesStep` | function | `warden:duplicates` — two sections saying the same thing, which the single-home rule forbids. |

## `@y-core/forge/warden/knowledge`

> Import path: `@y-core/forge/warden/knowledge` → `warden/src/search/mod.ts`

Building, opening and querying the index — everything the CLI and the MCP server are both written
against.

### Exports

| Symbol | Kind | Summary |
| --- | --- | --- |
| `search` | function | BM25 over the index, scaled by the document's weight and held to a coverage floor. |
| `Hit` | type | One ranked hit: its chunk id, its corpus and path, its heading trail, its score and its coverage. |
| `SearchOptions` | type | What a search may be narrowed by — corpus, path, limit, floor and the bridge table. |
| `corpusLabel` | function | Which corpus a section belongs to, in words rather than as an id prefix. |
| `coverage` | function | The share of a query's information each candidate chunk carries. |
| `documentFrequency` | function | How many chunks contain each term of a query. |
| `idf` | function | One term's inverse document frequency over the indexed corpus. |
| `readSection` | function | One section by chunk id, with its children or its neighbours when either is what makes it readable. |
| `readDocument` | function | Every section of one document, whole. |
| `outline` | function | Every section of one document with its one-line summary. |
| `Section` | type | One section read whole: its id, corpus, path, title, heading trail and body. |
| `OutlineEntry` | type | One outline line: the section, its title, its summary and its nesting level. |
| `related` | function | What a section defers to, what it cites, and what cites it. |
| `unresolved` | function | The citations that resolved to no indexed document, optionally scoped to the corpora a repository owns. |
| `Related` | type | One edge, resolved or raw. |
| `aliasTerms` | function | A query's terms with the corpus's own synonyms folded in. |
| `ALIASES` | const | Every bridge in the file, whatever tree it belongs to — the default for a caller naming none. |
| `AliasTable` | type | A bridge table: each term a reader might type, mapped to the terms the corpus files it under. |
| `aliasesFor` | function | The bridges a repository of one tree is served — the shared table plus its own. |
| `SHARED` | const | The bridges every repository earns, whatever tree it is subject to. |
| `LIBS` | const | The bridges whose targets are the library's own vocabulary. |
| `APPS` | const | The bridges an application's corpus earns and a library's does not. |
| `matchExpression` | function | An FTS match expression for a natural-language question. |
| `terms` | function | A query reduced to its searchable terms. |
| `openIndex` | function | Opens the index, rebuilding it when it is stale, and carries an advisory when it could not. |
| `rebuild` | function | Rebuilds the index from disk and reports what it wrote. |
| `Knowledge` | type | An open index: the database, its bridge table, the advisory, and the handle that closes it. |
| `OpenOptions` | type | Where the index lives, which canon root to read, the canon version to stamp, and whether the installed library is served. |
| `build` | function | Writes documents, chunks and relations into an open database. |
| `load` | function | Reads and chunks one document from disk. |
| `BuildReport` | type | What a build wrote: documents, chunks, relations, how many citations resolved to nothing, and which named more than one document. |
| `openDatabase` | function | Opens a database at a path, creating the schema when it is absent. |
| `indexPath` | function | Where the working index lives for a repository. |
| `gateIndexPath` | function | Where the gate's own index lives, kept apart from the working one. |
| `freshness` | function | Whether the index still matches the documents and the canon version on disk. |
| `Freshness` | type | The verdict, and the reason behind it. |
| `advisory` | function | The one line a stale index says about itself, or nothing when it is fresh. |

## `@y-core/forge/warden/mcp`

> Import path: `@y-core/forge/warden/mcp` → `warden/src/mcp/mod.ts`

The MCP server: the tool and resource surface, the JSON-RPC framing, and the stdio transport.

### Exports

| Symbol | Kind | Summary |
| --- | --- | --- |
| `TOOLS` | const | The declared tools — search, read, outline, related and impact. |
| `callTool` | function | Runs one tool against an open index. |
| `ToolSpec` | type | A tool's declared shape, as `tools/list` returns it. |
| `ToolResult` | type | One tool's result, in MCP's content shape. |
| `RESOURCES` | const | The one fixed resource: the catalogue. |
| `TEMPLATES` | const | The two parameterised resources, one per corpus. |
| `readResource` | function | Reads one resource by URI, or nothing when the URI names none. |
| `ResourceSpec` | type | A fixed resource, as `resources/list` returns it. |
| `ResourceTemplate` | type | A parameterised resource, as the template list returns it. |
| `ResourceContents` | type | One resource's contents, in MCP's shape. |
| `serveStdio` | function | Serves the corpus over MCP on stdio. |
| `serve` | function | Serves over any transport, stdio being one of them. |
| `handle` | function | Answers one request, so the protocol is testable without a transport. |
| `Transport` | type | What `serve` reads from and writes to. |
| `parseRequest` | function | Parses one JSON-RPC request, or reports why it is not one. |
| `encode` | function | Encodes one response as a framed line. |
| `takeLines` | function | Splits a buffer into whole lines, keeping the partial tail. |
| `ok` | function | A successful JSON-RPC response. |
| `err` | function | A JSON-RPC error response. |
| `RPC_ERRORS` | const | The JSON-RPC error codes the server answers with. |
| `RpcRequest` | type | One parsed request. |
| `RpcResponse` | type | One response, successful or not. |

## Selecting the Tree

**`libs` is declared; everything else is `apps`.** `"warden": { "kind": "libs" }` in `package.json`
selects the library trees. An absent key, an absent `warden` object and an absent `package.json` all
resolve to `apps`, so an application repository needs no configuration at all. Because the default
is silent about a library that dropped its declaration — and a sync would then replace its agents
with the apps set — `warden sync` says when it defaulted.
