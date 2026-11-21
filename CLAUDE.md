# CLAUDE.md

Forge is a web standards platform for server-rendered applications on Cloudflare Workers. It ships raw TypeScript with no build step, consumed
through the `@y-core/forge/{namespace}` export map, as a facade over `valibot` and `@remix-run/*`; `render/jsx` is its own SSR runtime. No
deprecation shims before v1.0.0: a breaking change is made outright (`FORGE_STRUCTURE.md` §7).

The rules are the governing documents, served by warden: `knowledge_search` and `knowledge_read`, or `warden search` and `warden read <id>`. Search
before inferring one (`AGENT_GUIDE.md` §1). The canon is on disk under `warden/canon/` and identical across the fleet, so cite it by document and
section and put a ruling of forge's own in `docs/`. Agents are `cc-plan` → `cc-dev` → `cc-test`, with `cc-doc` and `cc-tester`, written by
`warden sync` from `warden/claude/`; sessions are `claude -n forge-dev` and `claude -n forge-review`, and a task moved to review ends with the
`handoff` skill. A code review starts with the `warden-review` skill. When compacting, keep the task ids and their lanes, the epic, any open
handoff and the last check.

## Checks

| Check | Command | When |
| --- | --- | --- |
| Interim | `bun run verify:static` | While writing — every step that judges the source without running it |
| Task | `bun run verify:unit` | Before a task moves to review; yours to run |
| Epic | `bun run verify` | Once, when an epic closes — sent to `cc-tester` |
| Browser spec | one spec, one engine | Only where a UI change needs confirming (`TESTING.md` §6a) |

Not findable from `package.json`: `bun run verify --only <step>` runs one step, and `bun run verify --list` prints a tier's steps. The steps live in
`config/steps.config.ts`, and the gate is `TEST_RUNNERS.md` §6. `verify:scheduled` belongs to the release command and the daily cron; agents do not
run it.

Use `oxlint` (not `eslint`), `bun fmt` (not `prettier`, `oxfmt` or `biome`), `bun check` (not `tsc`), and the custom types stub (not `bun-types`).

## Where new code goes

Put code in the namespace its concern belongs to, and extend an existing capability rather than duplicating it. Classify a namespace as leaf or
integration first, and add no undeclared cross-namespace dependency (`NAMESPACE_DESIGN.md` §3). Runtime source uses standard Web APIs only, because
it runs on Workers; `src/tooling/` is the build-time exception.

| Adding… | Goes to | Recipe |
| --- | --- | --- |
| Authentication, permissions, API-key lifecycle | `auth` — identity is application-layer, never `security` | `NAMESPACES.md` §5h |
| CORS, webhook signature verification | `security` — transport-layer hardening only | `NAMESPACES.md` §5a, §5l |
| SSR component | `ui/core` (markup only) | `NAMESPACES.md` §5b, `UI_SSR_COMPONENTS.md` |
| Browser controller, signal, lazy resource | `ui/client` — never imported from Worker code | `UI_CLIENT_RUNTIME.md` §2 |
| A third pipeline builder beyond `definePage`/`defineAction` | a new `handler` namespace holding all of them | `NAMESPACES.md` §5c |
| Response builder, header class, streaming | `http` — never `@remix-run/headers` directly | `NAMESPACES.md` §5d |
| Escaping, URL scheme checks, `SafeHtml` | `html` | `NAMESPACES.md` §5m |
| A renderer or a construct inside one | a child of `render/` | `NAMESPACES.md` §5j |
| A design rule or UI anti-pattern | `src/ui/design/`, not `docs/` | `UI_DESIGN_GUIDANCE.md` §5a |
| Build-time module | drives a builder → `src/tooling/assets`; is one → the namespace owning the artifact | `ASSET_PIPELINE.md` §2c |
| A relaxation production must not hold | a `*.dev.ts` behind a strict-by-default `#relax` import | `NAMESPACES.md` §5i |
| An app secret recoverable at rest | `crypto/keyring`, not `auth` | `NAMESPACES.md` §5k |
| A command, gate check, lint rule, release step, D1 verb | `src/tooling/*` — never Worker-reachable | `NAMESPACES.md` §5g |
