# CLAUDE.md

{{ONE_PARAGRAPH_DESCRIPTION}} — what this application is, what it runs on, and the shared library it consumes. Keep it to three lines.

The rules are the governing documents, served by warden: `knowledge_search` and `knowledge_read`, or `warden search` and `warden read <id>`. Search
before inferring one (`AGENT_GUIDE.md` §1), and cite the canon by document and section. A ruling of this repository's own goes in `docs/`.
Agents are `cc-plan` → `cc-dev` → `cc-test`, with `cc-doc` and `cc-tester`; sessions are `claude -n forge-dev` and `claude -n forge-review`, and
a task moved to review ends with the `handoff` skill. A code review starts with the `warden-review` skill. When compacting, keep the task ids
and their lanes, the epic, any open handoff and the last check.

## Checks

| Check | Command | When |
| --- | --- | --- |
| Interim | `bun run verify:static` | While writing — every step that judges the source without running it |
| Task | `bun run verify:unit` | Before a task moves to review; yours to run |
| Epic | `bun run verify` | Once, when an epic closes — sent to `cc-tester` |
| Browser spec | one spec, one engine | Only where a UI change needs confirming (`TESTING.md` §6e) |

Not findable from `package.json`: `bun run verify --only <step>` runs one step, and `bun run verify --list` prints a tier's steps. The steps live
in `{{STEPS_CONFIG_PATH}}`. `verify:scheduled` belongs to the release command and the daily cron; agents do not run it.

Use `oxlint` (not `eslint`), `bun fmt` (not `prettier` or `oxfmt`), `bun check` (not `tsc`), and the hand-written types stub (not a runtime-specific
type package). `bun run dev` builds assets and starts `forge cf dev`; `bun run build:assets` is the production asset build.

## Where new code goes

Put code in the layer its concern belongs to, and never duplicate a capability the shared library already provides. {{ARCHITECTURE_PARAGRAPH}} —
the composition root, the entry split, and anything about this application's shape a placement decision turns on.

| Adding… | Goes to | Recipe |
| --- | --- | --- |
| {{CONCERN}} | {{LAYER_AND_FILE}} | {{DOC}} §{{N}} |

Every row names a concrete destination and a section-anchored recipe; a row that says only "see the docs" is unfinished.
