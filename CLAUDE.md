# CLAUDE.md — Architectural Constitution

> Namespace-based shared library for Cloudflare Workers.
> Ships raw TypeScript. No build step. Consumed via the `@y-core/forge/{namespace}` export map.

---

## Behavioral Rules (always enforced)

- ONLY do what has been asked, and never add a runtime dependency without approval
  (`AGENT_WORKFLOW.md` §1)
- NEVER use Bun-specific or Node.js APIs in runtime source files (standard Web APIs only)
- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER provide deprecation shims or backward-compatible paths before v1.0.0
  ([`LIBRARY_ARCHITECTURE.md`](docs/LIBRARY_ARCHITECTURE.md) §7)
- NEVER exceed the comment budget — one line of TSDoc per export, the `@public`/`@internal` tags,
  and the rare inline _why_, nothing else
  ([`CODE_RULES.md`](warden/canon/libs/CODE_RULES.md) §5)
- ALWAYS delete unbudgeted comments from any file you touch, routing rationale worth keeping to its
  single home ([`CODE_RULES.md`](warden/canon/libs/CODE_RULES.md) §5c)
- ALWAYS give an exported symbol a domain word, so it can be found from a question and not only from
  a reference — `create` plus a generic noun is a prefix, not a name. One domain word is the floor
  and roughly the ceiling ([`CODE_RULES.md`](warden/canon/libs/CODE_RULES.md) §7)
- ALWAYS add new public symbols to the namespace's `mod.ts` as a named export
- ALWAYS co-locate tests (`*.test.ts` / `*.test.tsx`) with the source they test
- ALWAYS enforce exact-match test assertions accounting for HTML entities — never substring matching
- ALWAYS run local verification after changes — **the full gate goes to `cc-tester`**; a single
  scoped step is yours to run (`AGENT_WORKFLOW.md` §4)
- ALWAYS write for the reader, not the record — a governing document and a message to a person are
  both judged on whether their reader gets what they need, can find it, can understand it, and can
  act on it (`PLAIN_LANGUAGE.md` §2). Lead with the outcome, match length to substance,
  and never compress away a caveat that would change what the reader does next
  (`PLAIN_LANGUAGE.md` §3d, §8)
- ALWAYS report a command's exit status with the one canonical suffix — never a variant
  (`AGENT_WORKFLOW.md` §3)
- ALWAYS reach the ledger over MCP, and never work from a remembered copy of its rules
  (`AGENT_WORKFLOW.md` §5). Scope is a property of the URL, so no ledger tool takes a `project`
  argument
- **Governance is overwrite-on-sync.** Never edit the canon under `warden/canon/` to record a
  ruling that is forge's own — it is byte-identical across every repository that clones it, and
  forge is the one repository where the files are writable. A local ruling goes in `docs/`
  ([`AGENT_GUIDE.md`](warden/canon/shared/AGENT_GUIDE.md) §6d)
- Use `rg` for content search, `find` for file search, and LSP for definitions and references
  (`AGENT_WORKFLOW.md` §2)

---

## Toolchain

| Tool | Role |
| --- | --- |
| `bun` | Package manager and test runner |
| `tsc` (`typescript` 7) | Type checker — the native compiler |
| `oxlint` | Linter, incl. type-aware rules (use instead of `eslint`) |
| `oxfmt` | Formatter and import sorter (use instead of `prettier`) |

```bash
bun run verify                 # the gate — the `standard` tier, what a task closes on
bun run verify:fast            # the inner loop (`verify --mode fast`) — typecheck, lint, format, test
bun run verify:full            # the release gate (`verify --full`) — everything, prerequisites included
bun run verify --only lint     # one step, for the dev loop (any step label)
bun run verify --list          # print the steps of the selected mode, run none
bun run lint                   # check only, never write (`verify --only lint`)
bun run fix                    # every step's fixer (`verify --fix`) — the set is `config/steps.ts`
```

Gate philosophy, the three modes, and the flags: [`TESTING.md`](docs/TESTING.md) §6.
The step list itself is `config/steps.ts`.

**Avoid:** `bun-types` (use the custom stub), `eslint` (use `oxlint`), `prettier` (use `oxfmt`), `biome` (retired — use `oxfmt`).

**The full gate goes to `cc-tester`**, which returns a terse verdict and never the stream; a single
scoped step — `bun run verify --only lint`, or the one test file just written — is the owning
agent's to run. `cc-plan`, `cc-dev`, `cc-doc` and `cc-test` each work on that basis
(`AGENT_WORKFLOW.md` §4).

---

## Architecture

Forge is a **facade** over its external dependencies (`valibot` via `validation`, `@remix-run/*`
via `router`, `app`, `http`, and `session`). The `jsx` namespace is an **in-house SSR runtime**,
not a facade for any third-party library. Consumers import from `@y-core/forge/{namespace}`, never
from a wrapped package directly.

**Pattern:** `src/{name}/mod.ts` barrel → implementation files → co-located tests.

**Leaf vs integration:** classify a namespace before adding code, and never introduce an undeclared
cross-namespace dependency ([`NAMESPACE_DESIGN.md`](warden/canon/libs/NAMESPACE_DESIGN.md) §3).

For the namespace catalog, barrel rules, and growth recipes, search for the governing `docs/`
document rather than restating any of it here.

---

## Governing Documents

Every governing document — the fleet canon and forge's own `docs/` — is indexed by warden and
reached by asking, never from a table here. `knowledge_search` ranks the corpus and returns a chunk
id; `knowledge_read` returns that section whole; `knowledge_outline` lists a document's sections.
The `knowledge://catalogue` resource is the map of both corpora, each document with the sentence its
own frontmatter uses. From a terminal the same index is `warden search`, `warden read <id>` and
`warden outline <path>`. Search before inferring an architectural rule — an empty result is an
answer (`AGENT_GUIDE.md` §1).

**The canon is not on disk in a consumer.** Forge is its home, so the fleet's portable rules are
readable here under `warden/canon/` and a citation may link one relatively — the link resolves, and
`validate-docs` holds the path against the file. The name and the section are still what the
citation is (`AGENT_GUIDE.md` §6d), because they are what a consumer reading the same rule has.

---

## Growth Rules

Add new code in the namespace its concern belongs to; follow the recipe in the governing doc —
never duplicate a capability that already exists.

| Adding… | Goes to | Recipe |
| --- | --- | --- |
| Authentication (JWT, OAuth, session login), permissions/RBAC, API-key lifecycle | NEW `auth` namespace — identity is application-layer, never `security` | [`NAMESPACES.md`](docs/NAMESPACES.md) §5a |
| CORS middleware, webhook signature verification | `security` — transport-layer request/response hardening only | [`NAMESPACES.md`](docs/NAMESPACES.md) §5a, [`BOUNDARIES.md`](warden/canon/libs/BOUNDARIES.md) §2 |
| SSR component | `ui/core` (markup only); client behaviour goes in `ui/client` | [`NAMESPACES.md`](docs/NAMESPACES.md) §5b, [`UI_SSR_COMPONENTS.md`](docs/UI_SSR_COMPONENTS.md) |
| Browser controller, signal, or lazy-loaded resource | `ui/client` — never imported from a Worker-executed file | [`BOUNDARIES.md`](warden/canon/libs/BOUNDARIES.md) §1, [`UI_CLIENT_RUNTIME.md`](docs/UI_CLIENT_RUNTIME.md) §2 |
| Third pipeline-builder variant (beyond `definePage`/`defineAction`) | extract ALL pipeline builders into a NEW `handler` namespace | [`NAMESPACES.md`](docs/NAMESPACES.md) §5c |
| HTTP output concern (response builders, header classes, HTML escaping, streaming) | `http` — never `@remix-run/headers`/`@remix-run/html-template` directly | [`NAMESPACES.md`](docs/NAMESPACES.md) §5d |
| Design rule or UI anti-pattern (which component to reach for, what good looks like) | `src/ui/design/` — never `docs/` | [`UI_DESIGN_GUIDANCE.md`](docs/UI_DESIGN_GUIDANCE.md) §5a |
| Build-time module — ask "does this drive an external builder, or is it one?" | drives one → `src/tooling/assets`; **is** one → the namespace owning the artifact | [`ASSET_PIPELINE.md`](docs/ASSET_PIPELINE.md) §2c |
| Developer-facing tool — a command, a gate check, a lint rule, a release step | `src/tooling/{cli,term,gate,lint,release,cf,assets}` — never Worker-reachable | [`NAMESPACES.md`](docs/NAMESPACES.md) §5g |
