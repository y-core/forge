# CLAUDE.md — Architectural Constitution

> {{ONE_PARAGRAPH_DESCRIPTION}} — what this application is, what it runs on, and the shared
> library it consumes. Replace this blockquote; keep it to three lines.

---

## Behavioral Rules (always enforced)

- ONLY do what has been asked, and never add a runtime dependency without approval
  (`AGENT_WORKFLOW.md` §1)
- NEVER hardcode API keys, secrets, or credentials in source files; never commit a secrets file
- NEVER provide deprecation shims or backward-compatible paths before v1.0.0
- NEVER reach into `node_modules` or import a wrapped dependency directly — every shared-library
  capability comes from its published subpath (`FORGE_CONSUMPTION.md` §2)
- NEVER write a comment outside the budget in `CODE_RULES.md` §5 — one line
  of TSDoc per export, the `@public`/`@internal` tags, and the rare inline _why_. Nothing else.
  No `@example` blocks, no multi-paragraph rationale, no restating the code, no section banners,
  no TODOs. Code is the documentation; prose is a cost paid on every read. Fix an unclear line
  with a better name, not a comment
- ALWAYS delete unbudgeted comments from any file you touch — there is no grandfathering, and
  rationale worth keeping is routed to its single home (`CODE_RULES.md` §5c)
- ALWAYS give an exported symbol a domain word, so it can be found from a question and not only
  from a reference — `create` plus a generic noun is a prefix, not a name. One domain word is the
  floor and roughly the ceiling; do not lengthen a name past it
  (`CODE_RULES.md` §7)
- ALWAYS check the shared library before writing a cross-cutting capability
  (`FORGE_CONSUMPTION.md` §1a)
- ALWAYS validate untrusted input at the boundary; services receive typed domain objects
- ALWAYS declare a route's guards in its middleware list, never inline in the handler
- ALWAYS enforce exact-match test assertions accounting for HTML entities — never substring
  matching on markup
- ALWAYS run local verification after changes — **the full gate goes to `cc-tester`**; a single
  scoped step is yours to run (`AGENT_WORKFLOW.md` §4)
- ALWAYS report a command's exit status with the one canonical suffix — never a variant
  (`AGENT_WORKFLOW.md` §3)
- ALWAYS reach the ledger over MCP, and never work from a remembered copy of its rules
  (`AGENT_WORKFLOW.md` §5)
- **Governance is overwrite-on-sync.** Never edit the canon in this repository;
  it is byte-identical across every application that clones the shared corpus, and an in-place
  edit is silently reverted by the next sync. A local ruling goes in
  `docs/**` (`AGENT_GUIDE.md` §6d)
- ALWAYS write for the reader, not the record — a governing document and a message to a person
  are both judged on whether their reader gets what they need, can find it, can understand it,
  and can act on it (`PLAIN_LANGUAGE.md` §2). Lead with the outcome, match length to
  substance, and never compress away a caveat that would change what the reader does next
  (`PLAIN_LANGUAGE.md` §3d, §8)
- Use `rg` for content search, `find` for file search, and LSP for definitions and references
  (`AGENT_WORKFLOW.md` §2). LSP resolves a symbol once you hold one; a name is what gets you the
  first one, which is why exported names carry a domain word (`CODE_RULES.md` §7)
- Tasks are tracked in the task-forge ledger via the `ledger` MCP tools; scope is a property of the
  URL, so no tool takes a `project` argument (`AGENT_WORKFLOW.md` §5)

---

## Toolchain

| Tool | Role |
| --- | --- |
| `bun` | Package manager and test runner |
| `tsc` (`typescript` 7) | Type checker — the native compiler |
| `oxlint` | Linter, incl. type-aware rules (use instead of `eslint`) |
| `oxfmt` | Formatter and import sorter (use instead of `prettier`) |
| `wrangler` | Cloudflare Workers dev server and deploy |
| {{ASSET_PIPELINE}} | Client bundle and stylesheet pipeline |

```bash
bun run verify                 # the gate — every step must pass
bun run verify --only lint     # one step, for the dev loop (any step label)
bun run verify --list          # print the steps, run none
bun run verify:full            # the release gate — adds the steps needing a machine prerequisite
bun run dev                    # asset build + wrangler dev
bun run build:assets           # production asset build
```

**One command, two modes**, not two commands. `{{STEPS_CONFIG_PATH}}` is the single source of
truth for the gate's steps and which of them are full-only. Gate philosophy, the modes, and the
flags: `TESTING.md` §6.

**Avoid:** `npm`/`pnpm`/`yarn` (use `bun`), `eslint` (use `oxlint`), `prettier` (use `oxfmt`),
runtime-specific type packages (use the hand-written stub).

**The gate, its exit-status spelling, and who runs it are canon.** The full gate goes to
`cc-tester`, which returns a terse verdict and never the stream; a single scoped step — one step of
the gate, or the one test file just written — is the owning agent's to run (`AGENT_WORKFLOW.md` §4).
A command's exit status is stated with the one permitted suffix and no variant of it
(`AGENT_WORKFLOW.md` §3).

---

## Architecture

{{ARCHITECTURE_PARAGRAPH}} — the composition root, the entry split, and anything about this
application's shape that a placement decision turns on.

**Pattern:** one composition root → global middleware → declarative route map → controllers →
services → views, over a model of typed domain shapes.

**Layer discipline:** every unit belongs to exactly one layer, and the layer decides what it may
import. Resolve placement by **concern first, then latency, then thread cost**; when two layers
fit, pick the one further from the request path.

For the route inventory, the config schema, the bindings, and the concrete design system, search
for the governing `docs/` document rather than restating any of it here.

---

## Governing Documents

Every governing document — the fleet canon and this repository's own `docs/` — is indexed by warden
and reached by asking, never from a table here. `knowledge_search` ranks the corpus and returns a
chunk id; `knowledge_read` returns that section whole; `knowledge_outline` lists a document's
sections. The `knowledge://catalogue` resource is the map of both corpora, each document with the
sentence its own frontmatter uses. From a terminal the same index is `warden search`,
`warden read <id>` and `warden outline <path>`. Search before inferring an architectural rule — an
empty result is an answer (`AGENT_GUIDE.md` §1).

**The canon is not on disk here.** Cite one of its documents in prose (`CODE_RULES.md` §5c), never
by a path (`AGENT_GUIDE.md` §6d).

---

## Growth Rules

Add new code in the layer its concern belongs to; follow the recipe in the governing doc — never
duplicate a capability the shared library already provides.

| Adding… | Goes to | Recipe |
| --- | --- | --- |
| {{CONCERN}} | {{LAYER_AND_FILE}} | {{DOC}} §{{N}} |

Every row names a **concrete destination** and a **`§N`-anchored recipe**. A row whose recipe
column says only "see the docs" is not a rule; delete it or finish it.
