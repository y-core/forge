# CLAUDE.md — Architectural Constitution

> {{ONE_PARAGRAPH_DESCRIPTION}} — what this application is, what it runs on, and the shared
> library it consumes. Replace this blockquote; keep it to three lines.

---

## Behavioral Rules (always enforced)

- ONLY do what has been asked — recommend and get approval before any additions
- NEVER add runtime dependencies without approval
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
  scoped step is yours to run (see _Verification Delegation_)
- ALWAYS report a command's exit status with the one canonical suffix — never a variant (see
  _Shell Exit Checks_)
- ALWAYS reach the ledger over MCP, and never work from a remembered copy of its rules — the tool
  descriptions and the refusals carry them, and a refusal is acted on rather than guessed past
- **Governance is overwrite-on-sync.** Never edit the canon in this repository;
  it is byte-identical across every application that clones the shared corpus, and an in-place
  edit is silently reverted by the next sync. A local ruling goes in
  `docs/**` (`AGENT_GUIDE.md` §6d)
- ALWAYS write for the reader, not the record — a governing document and a message to a person
  are both judged on whether their reader gets what they need, can find it, can understand it,
  and can act on it (`PLAIN_LANGUAGE.md` §2). Lead with the outcome, match length to
  substance, and never compress away a caveat that would change what the reader does next
  (`PLAIN_LANGUAGE.md` §3d, §8)
- Use `rg` for content search and `find` for file search

---

## Code Intelligence

When tracing where a symbol is defined or finding all references to it, use LSP
(goToDefinition, findReferences, hover) instead of Grep. LSP gives exact results; Grep gives
text matches.

Use Grep/Glob for discovery (finding files, searching patterns). Use LSP for understanding
(definitions, references, type info).

After locating a file with Grep/Glob, use LSP to navigate within it rather than reading the
whole file.

LSP resolves a symbol exactly once you hold one; a name is what gets you the first one, which is
why exported names carry a domain word (`CODE_RULES.md` §7).

**`docs/` is a hidden directory, so a bare `rg` from the repository root does not search
it.** A broad `rg 'pattern'` silently returns no governance hit — which reads as "no such rule"
rather than "not searched". Search the governing documents by explicit path, or with `--hidden`:

```bash
rg 'pattern' docs/          # explicit path — preferred
rg --hidden 'pattern'             # whole tree, including docs/ and .claude/
```

The Guide Index below hands you the path, so the explicit form is the normal one; reach for
`--hidden` only when searching across governance and source at once.

---

## Ledger

Tasks are tracked in the task-forge ledger via the `ledger` MCP tools. Scope is a property of the
URL, so no tool takes a `project` argument.

- Move a task to `doing` when you start it; call again only when its state actually changes,
  never to narrate progress.
- A read carries the `revision` a later edit must cite — read before you write.
- Record the resolution with, or before, the move to `done`.
- On a refusal, act on the payload: `rule` names what was applied, `requires` names the arguments
  to add, `retryable` says whether the call could succeed.

---

## Toolchain

| Tool | Role |
| --- | --- |
| `bun` | Package manager and test runner |
| `tsgo` (`@typescript/native-preview`) | Type checker (use instead of `tsc`) |
| `biome` | Linter and formatter (use instead of `eslint`/`prettier`) |
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

**Avoid:** `tsc` (use `tsgo`), `npm`/`pnpm`/`yarn` (use `bun`), `eslint`/`prettier` (use
`biome`), runtime-specific type packages (use the hand-written stub).

### Shell Exit Checks

When a command's exit status must be stated explicitly, append **exactly** this suffix — same
spelling, same casing, same quoting, every time:

```bash
<command>; echo "EXIT:$?"
```

- Use `;`, never `&&` — with `&&` the echo is skipped precisely when the command fails, which is
  the only case worth checking.
- Never pipe within the same statement: `bun run verify | tail -20; echo "EXIT:$?"` reports
  `tail`'s status, not the gate's. Redirect first, then inspect the file:
  `bun run verify > /tmp/verify.log 2>&1; echo "EXIT:$?"`.
- Never invent a variant — `exit=$?`, `RC=$?`, or a re-quoted spelling all miss the allowlist and
  cost a fresh permission prompt each time.
- Omit the suffix when the exit code is not actually in question; a bare failing command already
  surfaces its status.

**There is exactly one permitted spelling, and `.claude/settings.local.json` allows exactly that
one.** An allowlist carrying several variants is how the rule stops being a rule.

### Verification Delegation

**The full gate goes to `cc-tester`** — `bun run verify` and any cross-cutting suite. It returns
a terse verdict — `✓ green`, or `✗` with the failing step and a minimal excerpt — **never the full
stream**.

**The reason is context isolation, not distrust.** A gate stream is thousands of lines the owning
agent would otherwise carry for the rest of its turn. So the rule follows the size of the output,
not the question of who may be trusted to read a result:

- **Cross-cutting or voluminous → `cc-tester`.** `bun run verify`, `verify:full`, a full suite.
- **A single scoped step → run it yourself.** `bun run verify --only lint`, or the one test file
  you just wrote, is a handful of lines; routing it through a second agent buys nothing
  (`PLAIN_LANGUAGE.md` §12). `cc-plan`, `cc-dev` and
  `cc-doc` each run scoped steps on that basis, and `cc-test` smoke-runs the single test file it
  just wrote.
- **A scoped green is never reported as a green gate**, whoever ran it.

On failure the **owning** agent fixes and re-delegates — the full gate never re-runs inside the
agent that owns the fix, `cc-tester` never edits the code it judges, and the baseline it
established is part of its verdict.

`cc-tester` declares a `tools:` allowlist without `Write`/`Edit`, but **enforcement is not
guaranteed**. Treat the whole split as convention: every agent obeys its stated boundaries because
it is told to, not because a mechanism stops it.

---

## Architecture

{{ARCHITECTURE_PARAGRAPH}} — the composition root, the entry split, and anything about this
application's shape that a placement decision turns on.

**Pattern:** one composition root → global middleware → declarative route map → controllers →
services → views, over a model of typed domain shapes.

**Layer discipline:** every unit belongs to exactly one layer, and the layer decides what it may
import. Resolve placement by **concern first, then latency, then thread cost**; when two layers
fit, pick the one further from the request path.

For the route inventory, the config schema, the bindings, and the concrete design system, consult
`docs/` via the **Guide Index** — never duplicate that detail here.

---

## Guide Index

> Before writing code, consult the relevant governing document. Each begins with a
> `## 0. Quick Reference` listing every section, so you can pick a section without reading the
> whole file.
>
> **The canon is not in this table, and not on disk here.** The fleet's portable rules are served
> by warden and reached by search — the `knowledge_search`, `knowledge_read` and
> `knowledge_outline` MCP tools, or `warden show <id>` from a terminal. Cite one in prose
> (`CODE_RULES.md §5c`), never by a path (`AGENT_GUIDE.md` §6d). The table below names this
> repository's own documents, and must agree with `docs/` in both directions (§5c).

### The canon — served by warden, never edited here

- `AGENT_GUIDE.md`: how governing documents are structured, numbered, sized, and cross-referenced; the canon/docs boundary; the single-home rule
- `PLAIN_LANGUAGE.md`: reader-centred prose for governing documents and for what an agent says to a person — relevant, findable, understandable, usable; response length, narration, corrections, scope, delegation
- `APP_ARCHITECTURE.md`: the composition root, the layer stack and its dependency rules, DI through config, concern-first placement, the feature sequence
- `FORGE_CONSUMPTION.md`: leverage the shared library first, never bypass its facade, local workaround versus upstream change, upgrading
- `WORKERS_PLATFORM.md`: the isolate model, post-response work, rate limiting, deploy safety and secrets, static assets
- `CODE_RULES.md`: seven coding rules — zero global state, explicit errors, validation first, testability, **the comment budget (§5)**, declarative style, name distinctiveness (§7)
- `BOUNDARIES.md`: SSR versus browser, middleware ordering and guard placement, validate-at-boundary, no-PII logging, fail-closed
- `ERROR_HANDLING.md`: the one `Result` primitive, failures crossing a layer, fragment versus page, the error taxonomy
- `TESTING.md`: the app-request pattern, the environment fixture, exact-match assertions, fail-closed expectations, the gate
- `CODE_REVIEW.md`: blocking invariants, tiered detection with a command per rule, severity calibration, known false positives

### Implementation — this repository only

- {{IMPLEMENTATION_DOC_ROWS}} — one row per file in `docs/`, each with a
  one-line description. Start with `SOURCE_OF_TRUTH.md` (the register
  `AGENT_GUIDE.md` §8 requires), then the route map, the
  config schema, the storage bindings, and the design system.

---

## Growth Rules

Add new code in the layer its concern belongs to; follow the recipe in the governing doc — never
duplicate a capability the shared library already provides.

| Adding… | Goes to | Recipe |
| --- | --- | --- |
| {{CONCERN}} | {{LAYER_AND_FILE}} | {{DOC}} §{{N}} |

Every row names a **concrete destination** and a **`§N`-anchored recipe**. A row whose recipe
column says only "see the docs" is not a rule; delete it or finish it.
