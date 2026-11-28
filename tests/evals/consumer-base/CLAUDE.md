# CLAUDE.md

A small server-rendered site on Cloudflare Workers, with one D1 database, built on `@y-core/forge` and consuming it only through its
`@y-core/forge/{namespace}` subpaths.

The rules are the governing documents, served by warden: `knowledge_search` and `knowledge_read`, or `warden search` and `warden read <id>`. Search
before inferring one (`AGENT_GUIDE.md` §1), and cite the canon by document and section. A ruling of this repository's own goes in `docs/`. Agents
are `cc-plan` → `cc-dev` → `cc-test`, with `cc-doc`, `cc-tester` and `cc-reviewer`. A task moved to review ends with the `handoff` skill, which
dispatches `cc-reviewer` in its own detached worktree `~/work/forge-eval-consumer-review`, and a reviewed one reaches `main` and the push through `merge`
(`AGENT_WORKFLOW.md` §5b). A release the user asked for goes through the `release` skill (`AGENT_WORKFLOW.md` §4b). A code review starts with the
`warden-review` skill. When compacting, keep the task ids and their lanes, the epic, the checked-out branch, any open handoff, the merged but
unpushed wave with its shas, and the last check.

## Checks

| Check | Command | When |
| --- | --- | --- |
| Interim | `bun run verify:static` | While writing — every step that judges the source without running it |
| Task | `bun run verify:unit` | Before a task moves to review; yours to run |
| Push | `bun run verify:unit` on the rebased tip | Before every push of `main` the `merge` skill makes |
| Epic | `bun run verify` on the rebased tip | Once, in place of the push check, before the push that closes an epic — sent to `cc-tester` |
| Browser spec | one spec, one engine | Only where a UI change needs confirming (`TESTING.md` §6e) |

Not findable from `package.json`: `bun run verify --only <step>` runs one step, and `bun run verify --list` prints a tier's steps. The steps live in
`config/steps.config.ts`. `verify:scheduled` belongs to the release command and the daily cron; agents run it only through a release the user asked
for.

Use `oxlint` (not `eslint`), `bun fmt` (not `prettier` or `oxfmt`), `bun check` (not `tsc`), and the hand-written types stub (not a runtime-specific
type package). `bun run dev` applies pending migrations and starts `forge cf dev`.

## Where new code goes

Put code in the layer its concern belongs to, and never duplicate a capability the shared library already provides. `src/worker.ts` is the
composition root, `createWorker`; `src/routes.ts` is the route map and `src/router.ts` binds it to the controllers. Tests drive the app through
`createWorker(...).request` from `tests/`.

| Adding… | Goes to | Recipe |
| --- | --- | --- |
| A page or a form handler | `src/controllers/<feature>.ts`, its route in `src/routes.ts`, bound in `src/router.ts` | `APP_ARCHITECTURE.md` §5a |
| A database query or any outbound call | `src/services/<concern>.ts` | `APP_ARCHITECTURE.md` §2c |
| Markup | `src/views/<page>.tsx`, given typed props | `APP_ARCHITECTURE.md` §2d |
| A domain type or a validation schema | `src/model/<concern>.ts` | `APP_ARCHITECTURE.md` §2a |
| A configured value | `src/app/config.ts`, read through `appConfig` | `APP_ARCHITECTURE.md` §3a |
| A table or a column | `config/db/schema.sql`, then `bun run db:compose` | `FORGE_CONSUMPTION.md` §1a |

Every row names a concrete destination and a section-anchored recipe; a row that says only "see the docs" is unfinished.
