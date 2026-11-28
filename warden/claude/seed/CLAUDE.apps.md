# CLAUDE.md

{{ONE_PARAGRAPH_DESCRIPTION}} — what this application is, what it runs on, and the shared library it consumes. Keep it to three lines.

The rules are the governing documents, served by warden: `knowledge_search` and `knowledge_read`, or `warden search` and `warden read <id>`. Search
before inferring one (`AGENT_GUIDE.md` §1), and cite the canon by document and section. A ruling of this repository's own goes in `docs/`. Agents
are `cc-plan` → `cc-dev` → `cc-test`, with `cc-doc`, `cc-tester` and `cc-reviewer`. A task moved to review ends with the `handoff` skill, which
dispatches `cc-reviewer` in its own detached worktree `~/work/{{repo}}-review`, and a reviewed one reaches `main` and the push through `merge`
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
`{{STEPS_CONFIG_PATH}}`. `verify:scheduled` belongs to the release command and the daily cron; agents run it only through a release the user asked
for.

`bun run verify --json` prints only the failures, each `{ step, rule, file, line, message }`; `warden check --diff main` (MCP `warden_check`) runs
the register's review patterns over a change, each hit with its triage. Code Mode is a user-level opt-in — `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1`
in `~/.claude/settings.json`'s `env`, on Claude Code v2.1.323 or later in an interactive session; the agents that edit list `REPL`, and
`cc-reviewer` and `cc-tester` do not, so their read-only guarantee holds.

Use `oxlint` (not `eslint`), `bun fmt` (not `prettier` or `oxfmt`), `bun check` (not `tsc`), and the hand-written types stub (not a runtime-specific
type package). `bun run dev` builds assets and starts `forge cf dev`; `bun run build:assets` is the production asset build.

## Where new code goes

Put code in the layer its concern belongs to, and never duplicate a capability the shared library already provides. {{ARCHITECTURE_PARAGRAPH}} —
the composition root, the entry split, and anything about this application's shape a placement decision turns on.

| Adding… | Goes to | Recipe |
| --- | --- | --- |
| {{CONCERN}} | {{LAYER_AND_FILE}} | {{DOC}} §{{N}} |

Every row names a concrete destination and a section-anchored recipe; a row that says only "see the docs" is unfinished.
