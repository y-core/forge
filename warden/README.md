---
title: Warden — the Governing Corpus and Its Machinery
description: "The fleet canon, the sync that keeps a repository in step with it, the knowledge index that serves it, and the gate checks that hold it true."
---

# warden

The fleet's governing corpus, and the machinery that keeps a repository in step with it.

`warden/` sits outside `src/` because it is not a runtime namespace and is never Worker-reachable. The import rule runs one way: warden may import
up into `src/tooling/`, and nothing in `src/` may import warden. `importBoundaryStep` enforces it.

## Who Warden Is For

**Warden serves the repositories that already depend on `@y-core/forge`, and only those.** It ships inside forge rather than as its own package, so
adopting it means taking forge whole. For a Workers app that is free — forge is already a dependency. For a repository that does not consume forge,
it is a large dependency bought for a SQLite index and a CLI, and the exchange is not worth it.

A repository outside that set keeps its governing documents as plain markdown it owns, reached by reading: a directory listing picks the document,
its `## 0. Quick Reference` picks the section. Such a repository may still follow the canon's _shape_ — numbered sections, a Quick Reference, the
single-home rule — without being served by warden. A single-purpose tool in maintenance is the standing example: it follows the shape and stays a
non-consumer.

That has consequences worth stating. A non-consumer gets no `warden sync`, so its agent definitions and skills are its own to maintain, and they
will drift from the fleet's unless someone reconciles them. And `docs/` is only warden's corpus convention where warden is in use — a repository
already using that directory name for something else is not obliged to rename it.

## Layout

| Path | What it holds |
| --- | --- |
| `canon/shared/` | The documents both kinds share, byte-identical |
| `canon/libs/` | The library corpus |
| `canon/apps/` | The application corpus |
| `claude/agents/` | Agent definitions — `shared/` plus one tree per kind, layered in that order |
| `claude/skills/` | Skills, laid out the same way — `shared/` plus one tree per kind |
| `claude/seed/` | `CLAUDE.md`, `AGENTS.md` and `settings.local.json`, written only when absent |
| `share/` | Example editor configuration `warden show` writes to stdout |
| `src/` | Every module — the command, the sync, the checks, the index, the MCP server |

**The canon is never copied into a consumer.** It is read from the installed `node_modules/@y-core/forge/warden/canon/`. A sync writes `claude/` and
nothing else, so a rule can never be edited in a consumer and silently reverted by the next sync.

## Commands

Every command takes `--root=<path>` to name the repository it acts on; the default is derived from warden's own install path. Every command that
reads the canon takes `--kind=<libs|apps>` to override the tree selection.

### Keeping a repository in step

```bash
warden sync                  # replace .claude/agents and .claude/skills
warden sync --init           # also seed CLAUDE.md, AGENTS.md and settings.local.json if absent
warden sync --check          # report drift and exit 1 if any, writing nothing

warden natives               # place the editor architecture's prebuilt native bindings
  --arch=<platform-arch>     # the target to fetch, overriding this machine's

warden show --zed            # write the Zed user settings to stdout, to merge by hand
```

**A synced tree is layered from more than one source, and replaced as one.** `.claude/agents` is `agents/shared/` then `agents/<kind>/`, and
`.claude/skills` the same; a file both carry lands as the kind tree's copy. The whole destination is staged and renamed over, so it is only ever a
complete tree or the one that was already there.

A sync deletes each of those directories wholesale. A repository-local agent or skill added since the last sync is lost — keep one outside them.
Nothing else under `.claude/` is touched, written or deleted.

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

**Only the canon's home repository commits a catalogue.** `warden catalogue` renders the fleet canon and nothing repository-specific, so the file is
byte-identical wherever it is written — forge owns it, and `wardenStep` asserts it only where `catalogue` is configured. Elsewhere the live
`knowledge://catalogue` resource is the copy, rendered per repository and stored nowhere. `--write` writes under the root it was given and refuses a
target inside `node_modules`.

**`--write` reads the canon off disk; printing reads the index.** An index holds `shared` plus its repository's own kind by design, so a catalogue
rendered from one could never carry the other tree — and the committed file's claim to cover the fleet canon would be false. The written file walks
every tree instead.

Search, read, outline and related also take `--gate`, which reads the gate's own index rather than the working one.

**An empty search result is an answer.** Search refuses a question the corpus does not cover rather than returning its least-bad matches, so
nothing governs a subject that comes back empty.

**A chunk id names the corpus and the path.** `canon:CODE_RULES.md#5c` is the fleet's law; `project:docs/TESTING.md#3b` is this repository's own. A
filename and a section number exist in both corpora, so the prefix is what says which one a hit came from.

## Choosing a subpath

Warden's subpaths of `@y-core/forge` are each a barrel. `validate-exports` proves every `@public` symbol reaches the barrel it belongs
to, in both directions, so the barrel is the export list — there is no table here to go stale beside it.

**`@y-core/forge/warden/steps`** is the one to reach for: gate steps ready to drop into a repository's `config/steps.ts`.

**`@y-core/forge/warden/checks`** publishes each check as a pure function from a config to a result, plus the document parsers they are built out of
— link definitions, numbered sections, fence stripping, frontmatter, the no-rot scan. Take it when you are calling a check outside a step, or
building a repository-specific check on the same parsers rather than writing a second markdown reader.

**`@y-core/forge/warden/knowledge`** is everything the CLI and the MCP server are both written against: building the index, opening it, and querying
it. Take it to embed retrieval somewhere neither of those reaches. Ranking is BM25 scaled by document weight and held to a coverage floor, which is
what makes an empty result an answer rather than a failure to match.

**`@y-core/forge/warden/mcp`** is the server: the tool and resource surface, the JSON-RPC framing, and the stdio transport. Its request handler is
separate from its transport, so the protocol is testable without one.

**Take `steps` unless you have a reason not to.** It is the whole of what a consuming repository needs: `wardenAppSteps` spreads the rows every
application appends, and `cloudflareWorkerSteps()` cannot emit them because it lives under `src/`, where nothing may import warden.

```ts
import { wardenAppSteps } from "@y-core/forge/warden/steps";

export const steps = [...cloudflareWorkerSteps({ root: ROOT }), ...wardenAppSteps({ root: ROOT, packageName: pkg.name, golden: GOLDEN })];
```

Each step's label is fixed, because a label is the `--only` token a developer types.

**The root subpath is the whole of warden, and nothing consumes it but forge's own command.** `import { createWardenCommands } from
"@y-core/forge/warden"` reaches every module — the corpus parser, the sync, the index and the CLI alike — which is what `warden/src/bin.ts` needs
and more than any consumer should take. A gate that pulls the root barrel for `docsStep` drags the MCP server and the SQLite index in behind it.

**`wardenStep`'s `catalogue` option belongs to the canon's home repository alone.** Configure it and the step asserts the committed catalogue; leave
it out and it does not, which is what every consumer wants.

## Selecting the Tree

**`libs` is declared; everything else is `apps`.** `"warden": { "kind": "libs" }` in `package.json` selects the library trees. An absent key, an
absent `warden` object and an absent `package.json` all resolve to `apps`, so an application repository needs no configuration at all. Because the
default is silent about a library that dropped its declaration — and a sync would then replace its agents with the apps set — `warden sync` says
when it defaulted.
