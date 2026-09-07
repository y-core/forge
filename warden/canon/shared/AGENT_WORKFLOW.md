---
title: Agent Workflow
description: "How an agent works in any repository: the posture it holds to, the tools it reaches for, the exit-status spelling, when the gate is delegated, and the ledger rhythm."
---

# Agent Workflow

> This document governs how an agent _works_ — the posture, the tool choices, and the handful of
> spellings and hand-offs that must be identical everywhere. It applies to every repository whatever
> its kind, which is why it is canon and not a repository's own `docs/`.
>
> It governs no domain and no code. What an agent must _know_ about a codebase belongs to that
> codebase's documents; what an agent must _do_ while working belongs here.
>
> Defers to: [`PLAIN_LANGUAGE.md`](./PLAIN_LANGUAGE.md) §12 for the restraint principle §4 applies
> to the gate, and to the rest of that document for what an agent says to a person;
> [`AGENT_GUIDE.md`](./AGENT_GUIDE.md) for how a governing document is written.

---

## 0. Quick Reference

- §1 Working Posture: only what was asked, and the two things that need approval first
- §2 Tool Selection: `rg` and `find` for discovery, LSP for definitions and references
- §3 Shell Exit Checks: the one permitted `; echo "EXIT:$?"` spelling and the three refusals
- §4 Verification Delegation: which sub-agent runs the gate, and the scoped-step exception
- §5 The Ledger Over MCP: the working rhythm, and why never to work from a remembered copy

---

## 1. Working Posture

**Do what has been asked, and only what has been asked.** An improvement nobody requested is a
change nobody reviewed: it arrives inside a diff whose stated subject is something else, so the
reader who approves the diff has not agreed to it. Recommend the addition, get approval, then make
it — as its own change.

Two additions are never made unilaterally, because both bind everyone downstream:

- **A runtime dependency.** Every consumer inherits it — its install size, its transitive tree, its
  release cadence and its vulnerabilities — and removing one after it ships is a breaking change.
  Propose it with what it replaces and why the standard library or an existing dependency will not
  do. A build-time or development dependency is a smaller commitment, not an exempt one.
- **A new abstraction the task did not call for.** An interface, a base class or an indirection
  layer introduced "for later" is a shape the next reader must satisfy before they may change
  anything through it.

**A concern with the request is stated once, in a sentence or two, and then the work proceeds.**
Deliver the whole scope under a stated assumption rather than stopping for an answer that does not
change what gets built; stop only where proceeding either way would be unsafe or would waste the
work if the guess were wrong. Scaling a task down is the requester's call, so a part left undone is
named as undone rather than quietly dropped.

---

## 2. Tool Selection

**`rg` for content, `find` for files.** Both are assumed present; a shell loop over `grep` is
neither faster nor more readable, and a `find | xargs grep` pipeline hides its own errors.

**LSP for understanding, search for discovery.** Where a language server is available, tracing a
definition or finding every reference goes through it — `goToDefinition`, `findReferences`, `hover`
— because those answers are exact. A text search returns the string, which is the same-named symbol
in three unrelated modules, the comment that mentions it, and the test that asserts on the word.
Use search to find the file; use the language server to navigate inside it.

That ordering is also why reading a whole file to answer a question about one symbol is the wrong
default: it costs the reader's attention on everything the symbol is not.

---

## 3. Shell Exit Checks

**Where a command's exit status must be stated explicitly, append exactly this suffix** — same
spelling, same casing, same quoting, every time:

```bash
<command>; echo "EXIT:$?"
```

Three refusals, each for the failure it prevents:

- **`;`, never `&&`.** With `&&` the echo is skipped precisely when the command fails, which is the
  only case worth checking.
- **Never pipe within the same statement.** `<command> | tail -20; echo "EXIT:$?"` reports `tail`'s
  status, not the command's. Redirect to a file first, then inspect the file.
- **Never invent a variant.** `exit=$?`, `RC=$?`, a bracketed banner or a re-quoted spelling all
  read identically to a person and not at all to an allowlist, and each one costs a fresh permission
  prompt.

**Omit the suffix where the exit code is not in question.** A bare failing command already surfaces
its status; the suffix exists for the cases where that signal would otherwise be lost — inside a
pipeline, behind a redirect, or where a command reports failure in its output and not in its status.

**There is exactly one permitted spelling, and the repository's local Claude settings file allows
exactly that one** — as an exact-string entry, not a prefix wildcard. Deviating by one character is
what turns a silent run into a prompt, and an allowlist carrying several variants is how the rule
stops being a rule.

---

## 4. Verification Delegation

**The full gate goes to one sub-agent, the verification runner** — the repository's whole `verify` command,
its release tier, and any cross-cutting suite. It returns a terse verdict: green, or a failure
naming the step with a minimal excerpt. **Never the full stream.**

**The reason is context isolation, not distrust.** A gate stream is thousands of lines the owning
agent would otherwise carry for the rest of its turn, so the rule follows the size of the output
rather than the question of who may be trusted to read a result:

- **Cross-cutting or voluminous → the runner.** The full gate, the release tier, a whole suite.
- **A single scoped step → run it yourself.** One step of the gate, or the one test file just
  written, is a handful of lines; routing it through a second agent buys nothing
  (`PLAIN_LANGUAGE.md` §12), and the delay is paid on every iteration of the inner loop.

**A scoped green is never reported as a green gate**, whoever ran it. One step passing is evidence
about one step.

**On failure the owning agent fixes and re-delegates.** The gate never re-runs inside the agent that
owns the fix, and the runner never edits the code it judges — the baseline it established is part of
its verdict, and an agent that both fixes and judges has no baseline left.

**The split is convention, and enforcement is not guaranteed.** A runner agent may declare a tool
allowlist without write access, but every agent obeys its stated boundaries because it is told to,
not because a mechanism stops it. That is a decision about where the cost of enforcement is worth
paying, not an omission.

---

## 5. The Ledger Over MCP

Where a repository tracks work in a ledger, it is reached over its MCP tools — never through a
remembered copy of its rules. The tool descriptions and the refusals carry the current rules, and
they are versioned with the ledger rather than with anything an agent read once.

The rhythm:

- **Move a task to the in-progress lane when work starts on it**, then call again only when its
  state actually changes. A lane move is not a progress report.
- **Read before writing.** A read carries the revision a later edit must cite; an edit citing a
  stale one is refused, which is the mechanism that makes concurrent work safe.
- **Record the resolution with, or before, the move to done.** A closed task with no resolution has
  lost the only account of why it could be closed.
- **Act on a refusal's payload rather than guessing past it.** It names the rule that was applied,
  the arguments a retry must add, and whether a retry could ever succeed. A refusal restating what
  was already tried is an answer, not an obstacle.
