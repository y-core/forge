---
title: Agent Evals
description: "How forge measures an agent's work on fixed tasks: the task layout, a run, how each figure is read, and the regression rule a re-run is held to."
audience: internal
---

# Agent Evals

> Owns the agent-eval method: what a task directory holds, what one run does, how each recorded figure is read, and the rule that decides whether a
> re-run regressed. The harness that implements it is `src/tooling/dev/eval/`, run as `bun run eval run|check|compare`; it is a developer tool and
> never Worker-reachable ([`NAMESPACES.md`][namespaces-5g] §5g).
>
> Defers to: `src/tooling/dev/eval/types.ts` for every field of a task spec and a round file; `src/tooling/dev/eval/run.ts` for the session argv and
> its tool list; `src/tooling/dev/eval/session.ts` for the timings that drive an interactive session; [`CODE_REVIEW.md`][cr-1b] §1b for the shape of
> a reviewer finding; [`TEST_RUNNERS.md`][tr-6] §6 for what `verify:unit` runs.

---

## 0. Quick Reference

- §1 Why the Evals Exist: proof that a change to the corpus or its tooling has not made agents worse
- §2 The Task Directory Layout: what `tests/evals/<task>/` holds and what `eval check` proves about it
- §2a The `task.json` Spec: the fields, and the trap and detector shapes
- §2b Proving a Spec Without a Session: the checks `eval check` runs before any session is spent
- §3 One Run of a Task: a fresh session in a throwaway tree, warden as its only MCP server, never merged
- §3a The Tree a Session Runs In: a detached forge worktree or a copy of the consumer template
- §3b The Author Session and the Review Session: the order of a run, and what each session may use
- §3c The Calibration Review: the reviewer alone, on the reference with every plant applied
- §4 How Each Figure Is Read: tokens, tool calls, and the docs a session read
- §4a Doc-Read Classification Table: which tool call counts as which kind of read
- §5 Through, Caught and Clean: what each trap verdict means, and calibration recall
- §6 The Regression Rule — How an Eval Re-Run Is Judged: the figures that regress a task, and when one cannot be compared
- §7 Refreshing a Patch That Does Not Apply: regenerate it, prove it, and say what it costs the comparison
- §8 Measuring Code Mode With Interactive Rounds: why a Code Mode round runs in a terminal, and what it asks of the user
- §8a How an Interactive Session Is Driven: trust, a settled turn, the exit, and why a session stalls
- §8b Billed Tokens: the cost figure that weighs each kind of token by an assumed price
- §8c The Code Mode GO/NO-GO Rule: when the "on" arm is worth turning on

---

## 1. Why the Evals Exist

**The evals prove that a change to the governing corpus, or to the tools that serve it, has not made agents worse at forge's work.** A rule moved
from prose into a detector, a change to how warden serves the corpus, and a cut to governing prose all claim to help an agent; each is measured
against a recorded baseline rather than taken on trust.

**A re-run is due after any such change, and is held to the baseline by §6.** The baseline is a committed round file,
`tests/evals/results/<round>.json`, and every later round is compared against it task by task.

A task is a fixed piece of forge work with known ways to get it wrong. Some run in a forge checkout, the rest in a consumer app that installs forge,
so the evals measure both the repository's own agents and a consumer's.

---

## 2. The Task Directory Layout

Each task is a directory under `tests/evals/` named for the task's id. `loadTask` in `src/tooling/dev/eval/spec.ts` refuses a directory that
lacks any file its spec names:

| File | What it is |
| --- | --- |
| `task.json` | The spec (§2a) |
| `prompt.md` | The author session's prompt, passed verbatim |
| `reference.patch` | A correct solution, as a diff against the base tree |
| `plants/<trap>.patch` | One per trap: the reference's mistake that trap detects, applied over the reference |
| bait patches | Applied to the base tree before the author starts, in the order `bait` lists them, at the paths it names |
| `accept/<path>` | Acceptance tests, and any test a `test` detector names, each at the path it is copied to in the tree |

Beside the task directories sit `consumer-base/`, the overlay a consumer tree is built from (§3a), and `results/`, the round files.

### 2a. The `task.json` Spec

`task.json` holds `id`, `tree`, `model`, `timeoutMinutes`, `bait`, `accept` and `traps`, and nothing else — the schema is strict. The id must
match the directory name. `tree` is `forge` or `consumer`. Every path is relative to the task directory or the tree, with no `..` segment.

A **trap** is a known way to get the task wrong: `{ id, rules, detector }`. `rules` holds the chunk ids of the rules it breaks, and a reviewer
finding citing any of them catches it (§5). The detector decides whether the trap fired, in one of three ways:

- **`rg`** — a ripgrep `pattern` over only the lines the diff adds under `paths`, with `pcre` for a PCRE2 pattern. It is the only detector that
  reports where it fired.
- **`step`** — a gate step by `label`; the trap fires when `bun run verify --only <label>` fails. It runs with `HEAD` moved back to the run's base
  commit, so a row that runs only on pending changes sees the run's whole change.
- **`test`** — a test `file` under `accept/`; the trap fires when that test fails.

### 2b. Proving a Spec Without a Session

**`bun run eval check` proves a task is ready to run, and a task is not run until it reports `ok`.** It spends no session. It builds the base tree
and reports a problem when:

- the base tree fails `verify:unit`, or `reference.patch` does not apply;
- the acceptance tests fail on the reference, or any trap fires on it;
- a plant does not apply over the reference, does not fire its own trap, or the plants do not all apply together;
- a chunk id in any trap's `rules` does not resolve through `warden read`.

---

## 3. One Run of a Task

**Every session is fresh, in a throwaway tree, with warden as its only MCP server, and nothing it produces is ever merged.** The tree is removed
when the run ends, whether it succeeded or threw. The diff each run produced is kept outside the repository, under the cache directory
`defaultEvalEnv` in `src/tooling/dev/eval/commands.ts` names.

`bun run eval run --round <name>` refuses a checkout with uncommitted changes, because a round measures one commit: every run in it starts from
`HEAD`, and the round file records that sha. An uncommitted result under `tests/evals/results/` is let through, since no run reads it. `--reps`
sets how many author runs each task gets, each paired with its own calibration review (§3c). Sessions run headless, with `-p`, unless
`--interactive` runs them in a terminal (§8).

### 3a. The Tree a Session Runs In

- **A `forge` task** runs in a detached worktree of `HEAD`, with the checkout's `node_modules` linked in.
- **A `consumer` task** runs in a copy of a template built once per forge commit: `tests/fixtures/workers-consumer` with `tests/evals/consumer-base`
  laid over it, this checkout packed and installed as `@y-core/forge`, and the result committed in a fresh git repository.

In either tree the harness indexes the corpus with `warden index`, applies the bait and commits, which gives the base commit every session in the
run starts from. A consumer tree's warden indexes, serves and reads with `--dependency`, as a consumer's own gate rows do, so its sessions and
`eval check` reach the installed forge's consumer-facing documents.

### 3b. The Author Session and the Review Session

A run takes these steps, in order:

1. **The author session** runs `prompt.md` in the tree. Whatever it leaves is committed, even when it changed nothing.
2. **The review session**, a second fresh session in the same tree, runs `/warden-review <author-sha>^!` with a suffix asking for the findings as a
   closing JSON block. A reply with no readable block records `reviewParseFailed` and no findings. A review session whose transcript holds no
   assistant message records `invalid`, naming the session, and `compare` leaves the record out (§6).
3. **`verify:unit`** runs in the tree, and its result is recorded.
4. **Each trap's detector** runs against the tree and the author's diff, and each trap is judged against the findings (§5).
5. **The acceptance tests** are copied in from `accept/`, run, and removed again. The run is accepted when every one passes.

**Both sessions run under one permission posture and one tool list.** Each is allowed exactly the tools `ALLOWED_TOOLS` in
`src/tooling/dev/eval/run.ts` lists, never with permissions bypassed. A headless session runs with `--permission-mode acceptEdits`; an interactive
one runs with `dontAsk`, so a tool outside the list is refused rather than put to a prompt no one is there to answer. Each runs under
`--strict-mcp-config` and the round's MCP config for its tree kind, which names warden alone, so no session can reach the ledger. Each loads only
the `user` and `project` setting sources, which the round file records as `settingSources`: Claude Code reads a linked worktree's `local` settings
from the main checkout, so one developer's local settings would otherwise reach every forge tree. A session that reaches the task's `timeoutMinutes`
is killed and the run records `timedOut`; the steps after it still run on what was committed.

### 3c. The Calibration Review

**A calibration review measures the reviewer alone.** It runs on the base tree with `reference.patch` and every plant applied, so every trap is
known to be present, and runs only the review session and the detectors. Its verdicts feed calibration recall (§5), never the author's figures.

---

## 4. How Each Figure Is Read

A session's figures are read from the transcript Claude Code writes, together with the transcript of every subagent it dispatched, so a delegated
read counts against the session that delegated it. `src/tooling/dev/eval/transcript.ts` owns the parsing.

- **Tokens** are summed once per message id, because a transcript repeats a message's usage on every line that message spans. A round file keeps
  input, cache creation, cache read and output separately. **Prompt tokens** are the first three summed — what the session was given to read.
- **Assistant messages** are counted once per message id. A review with none never ran, and invalidates its record (§3b).
- **Tool calls** are counted once per tool-use id, in total and by tool name.
- **Doc reads** are classified by the route they took (§4a).

The author's and the reviewer's figures are recorded separately. The regression rule reads the author's (§6); the reviewer's are recorded so a
change in review cost is visible, but they do not decide a regression.

### 4a. Doc-Read Classification Table

Each tool call falls in at most one row, except a Bash command, which can match both of the Bash rows:

| Tool call | Counted as | Also collected |
| --- | --- | --- |
| `mcp__warden__knowledge_search`, `_read`, `_outline`, `_related`, `_impact` | `warden.<tool>`, one count per tool | the chunk id each `knowledge_read` was given, as `chunks` |
| `Read` of a path ending `.md` | `mdFileReads` | the path, as `mdPaths` |
| `Bash` running `warden search`, `read`, `outline`, `related` or `impact` | `wardenCli` | — |
| `Bash` running `cat`, `sed`, `head`, `tail`, `less` or `awk` on a `.md` path before any pipe or separator | `bashMdReads` | — |
| Anything else | only the tool-call totals | — |

**`bashMdReads` is a heuristic, so it is never added to `mdFileReads`.** A command can name a `.md` file without printing it, and print one
without naming it; read the figure as a signal that a session bypassed warden, not as a count of documents read. `chunks` and `mdPaths` are sorted
and deduplicated, so they say which documents were read, and the counts say how often.

---

## 5. Through, Caught and Clean

**Each trap gets one verdict per run.** A trap whose detector did not fire is **clean**. A trap that fired is **caught** when some reviewer finding
cites one of its `rules`, or names a location in the same file within a few lines of a line an `rg` detector hit; otherwise it is **through**.
`matchFindings` in `src/tooling/dev/eval/review.ts` owns the match and its line window.

A `step` or `test` detector reports no location, so its trap is caught only by a finding that cites its rule. A run whose review could not be
parsed has no findings, so every trap it fired counts as through — read a rise in `through` alongside `reviewParseFailed`. In an invalid record a
trap that fired is **unreviewed**, never through, because no review judged it.

**`through` is the figure that matters most: a mistake the author made and the reviewer missed is one that would have reached `main`.** A caught
trap cost a review round; a clean one cost nothing.

**Calibration recall** is the share of fired traps the calibration reviews caught: caught over caught plus through, across every calibration review
of the task. Because §2b proves every plant fires its own trap, every trap is planted in a calibration tree, so recall measures the reviewer on
known mistakes, independent of what the author did. A task with no fired trap in calibration has a recall of 100%.

---

## 6. The Regression Rule — How an Eval Re-Run Is Judged

**A task regressed when a later round is worse than the earlier one on any of these figures**, and `bun run eval compare <before> <after>` exits 1
when any task did:

- **The acceptance rate falls** — the share of runs whose acceptance tests all passed.
- **`through` rises** — through verdicts per run, across every trap of the task.
- **Calibration recall falls.**
- **Median prompt tokens rise by more than 15%**, over the author's runs.
- **Median billed tokens rise by more than 15%**, over the author's runs (§8b).
- **Median tool calls rise by more than 15%**, over the author's runs.

The quality figures tolerate no movement at all; the cost figures tolerate 15%, because two sessions on the same task never spend exactly the same.
`compareRounds` in `src/tooling/dev/eval/compare.ts` implements the rule, and an equal or better figure never regresses. It reads no figure from
an invalid run or calibration record, and prints each one it left out with the reason the record gives. Beside these it prints the author's
median turns and its cache-read, cache-creation and output tokens, the breakdown behind the token rows, which never regress on their own.

**A task whose spec changed between the rounds cannot be compared, and counts as regressed.** Each task result records a hash of every file in its
task directory, path and content, so any edit to the prompt, a patch, a test or `task.json` changes it. `--allow-respec` compares such a task
anyway and marks it in the output; §7 says when that is legitimate.

**A task missing from the later round counts as regressed.** A task new in the later round has nothing to compare against, and is reported as new.

**`compare` refuses a headless round against an interactive one.** The two surfaces differ in permission mode and in how a session is run, so a
change in cost between them says nothing about the change under test. `--allow-mixed-mode` compares them anyway and marks the header; use it to
see the gap between the surfaces, never to judge a change.

---

## 7. Refreshing a Patch That Does Not Apply

A change to forge can move the lines a patch's context names, so a bait patch, `reference.patch` or a plant stops applying. A run reports it as
`<patch> does not apply`, and `bun run eval check` names which one.

Refresh it against the current tree:

1. Build the base tree by hand: a detached worktree of `HEAD`, or a copy of the consumer template, with the bait applied.
2. Make the same change the old patch made, and write the new patch with `git diff` against the base commit. A plant is written against the
   reference, not the base.
3. Run `bun run eval check --task <id>` until it reports `ok`.

**A `CHANGELOG.md` hunk is applied by text inside `[Unreleased]`, not by line, so a new entry there does not break a spec.** `applyPatch` in
`src/tooling/dev/eval/scaffold.ts` applies the rest of the patch with `git apply --exclude=CHANGELOG.md`. For each changelog hunk it finds the
leading context and removed lines as one block inside `[Unreleased]` and puts the leading context and added lines in their place, ignoring the
trailing context. Write a changelog hunk with the subsection heading as its leading context, so the entry goes first under `### Breaking Changes`
or `### Added`; only a release that empties `[Unreleased]` breaks it then. `git apply --3way` cannot do this. A consumer tree is a fresh
repository with none of the patch's blobs, and no repository holds a plant's preimage, so git falls back to a strict apply.

**A refresh changes the spec hash, so the next comparison of that task needs `--allow-respec`.** It is legitimate only when the refresh changed
where the patch applies and not what it does: the same solution, the same mistake, the same bait. A refresh that changes what the task asks or what
a trap detects is a new task, and its earlier figures are no baseline for it — compare it from the first round recorded after the change.

---

## 8. Measuring Code Mode With Interactive Rounds

**Code Mode can be measured only in an interactive session, because a headless `-p` session never has it.**
`bun run eval run --round <name> --interactive --code-mode on|off` runs every session of the round in a terminal; `--code-mode` defaults to `off`
and is refused without `--interactive`. The round file records the surface as `mode` and the arm as `codeMode`. Measure Code Mode as two
interactive rounds, one per arm, held to each other by §8c.

**Only the "on" arm sets Code Mode**, whatever the developer's shell carries, so their own setting cannot reach the "off" arm. An "off" session
that calls `REPL` anyway makes its record invalid. The auto-updater is off, because a round runs under one Claude version: `eval run` fails when
`claude --version` changed while the round ran.

**The "on" arm requires that you have accepted Code Mode's caveats yourself.** The harness refuses an "on" session unless
`codeModeCaveatsAcceptedV1` is set in `~/.claude.json`, and never sets it: accepting the caveats is the user's consent, and no tool can give it
on the user's behalf. Accept them once in your own interactive session before the first "on" round.

### 8a. How an Interactive Session Is Driven

Each session runs in a pseudo-terminal, driven by its own `bun` process, `src/tooling/dev/eval/session-bin.ts`, so the round stays synchronous:

1. **The tree is trusted first.** The driver marks it trusted in `~/.claude.json`, keeping every other key, so no trust dialog blocks the first
   turn. The entry is removed when the tree is, whether the run succeeded or threw.
2. **The turn is settled when the transcript says so, then stays quiet.** The driver reads the transcript, not the screen: the last record ends a
   turn, no tool call awaits its result, and no transcript file has changed for a quiet window.
3. **A settled session is sent `/exit`**, then `SIGTERM` and `SIGKILL` if it has not exited. A session that reaches its wall clock gets the two
   signals and records `timedOut`.
4. **The reply is read from the transcript**: the last assistant message that ended a turn.

**A stalled session is killed, its record is invalid, and its screen is saved.** A session stalls on a trust or permission dialog, which nobody is
there to answer; on no transcript soon after it starts; or on a turn that is unsettled, waits on no tool and leaves the transcript unchanged too
long. The screen, stripped of terminal escapes, goes to `<round>/<run>.pty.log` under the cache directory, beside the run's diff, with a
`-review` suffix for a review. It shows what the session was waiting for. `src/tooling/dev/eval/session.ts` owns the timings.

### 8b. Billed Tokens

**Billed tokens weigh each kind of token by its assumed price**, so a session that trades cheap cache reads for expensive output is not counted as
saving. Prompt tokens (§4) weigh every token alike and hide that trade. `BILLED_WEIGHTS` in `src/tooling/dev/eval/compare.ts`
holds each weight relative to an uncached input token.

**The weights are an assumption about the price list, not read from it.** When the prices change, change `BILLED_WEIGHTS` in
`src/tooling/dev/eval/compare.ts`; rounds judged under the old weights were judged on a different figure. §6 holds median billed tokens to the
same 15% as the other cost figures.

### 8c. The Code Mode GO/NO-GO Rule

**Code Mode is worth turning on only when it saves at least 15% of billed tokens at no cost in quality.** Given an "off" round and an "on" round,
in either order, `compare` prints `Code Mode GO` or `Code Mode NO-GO`. The saving is one minus the "on" arm's billed tokens over the "off" arm's,
each the sum of the per-task medians over the tasks both rounds hold. The verdict is GO only when:

- **the saving is at least 15%;**
- **no task loses acceptance, through per run or calibration recall**, with no tolerance — a cheaper agent that ships more mistakes saves nothing;
- **at most a third of either arm's runs of any task are invalid**, since an arm that often stalls would be judged only on the runs that finished;
- **both rounds ran at the same forge sha**, so the corpus did not change under the measurement.

**Both rounds must record the same Claude version, or `compare` prints no verdict**, since a different version is a different product.

**A saving within 5 points of 15% is a rerun, not a decision.** Two runs of a task never spend exactly the same (§6), so a saving that close can
fall on either side of the line by chance. `compare` says so on the verdict line; run both arms again with more `--reps` before deciding.

[cr-1b]: ../warden/canon/libs/CODE_REVIEW.md#1b-review-output-format
[namespaces-5g]: ./NAMESPACES.md#5g-tooling--where-a-developer-facing-tool-belongs
[tr-6]: ./TEST_RUNNERS.md#6-the-verification-gate
