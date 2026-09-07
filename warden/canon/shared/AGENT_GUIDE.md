---
title: Governing Document Guide
description: "How docs/ documents are structured, numbered, sized, cross-referenced, split between governance and implementation, and kept free of duplication."
---

# Governing Document Guide

> This guide is the authoritative source for how `docs/` documents are written and
> structured. It governs form — numbering, frontmatter, size, cross-references, and where a
> rule is allowed to live. It does not govern any domain; every domain rule belongs to the
> document that owns it.
>
> All new and updated documents in the canon and in `docs/` must follow these rules.
> Where a repository ships a documentation check, mechanically checkable subsets of §2, §4, §5,
> §6a, and §9 are enforced by it; where it does not, they are enforced by review.
>
> Defers to: [`PLAIN_LANGUAGE.md`](./PLAIN_LANGUAGE.md) for the quality of the prose inside that
> form — whether a heading says what is beneath it, and whether the reader can act on what they
> find. This guide decides that a `## 0. Quick Reference` exists; that one decides that it
> orients.

---

## 0. Quick Reference

- §1 Document Access Path: how to look up a governing rule — search, then read the section
- §2 Section Numbering Convention: why numbers exist and what a parser accepts
- §2a Level-2 and Level-3 Numbering: `## N.` and `### Na.` mechanics
- §2b Forbidden Heading Patterns: dot-notation, unnumbered headings, column-1 samples
- §2c Renumbering Is Atomic: renumber only in a commit that fixes every referrer
- §3 Section Title Guidelines: domain noun plus mechanism, 3–8 words
- §4 Frontmatter Requirements: the two mandatory fields
- §4a Title Field: 2–5 words, title-cased
- §4b Description Field: one prose sentence, ≤200 characters
- §5 Cross-Reference Format: how documents point at each other
- §5a Inter-Document Links: relative markdown links
- §5b Intra-Document Section References: the `§N` shorthand
- §5c The Agent Roster Is Reconciled Both Ways: no document register, but every agent named exists
- §5d Crossing the Governance Boundary: which direction a link may run
- §6 Document Size and Scope: what belongs in a governing document at all
- §6a Size Targets and the Split-or-Cut Threshold: 200–600 target, 800 hard fail
- §6b Subsection Citability Test: a `###` exists to be cited, not to be long
- §6c Decisions Versus Usage — the README Boundary: examples live beside the source
- §6d The Canon Versus This Repository's Docs: portable rule or local fact
- §7 Quick Reference Convention: one line per `##` and `###`
- §8 Single Home Rule and the Source-of-Truth Register: where each fact is allowed to live
- §9 No Dated or Ticketed Content: no dates, task IDs, or changelog notes

---

## 1. Document Access Path

**To look up a governing rule, search for it and then read it.** Do not infer a rule, and do
not hunt for the document by hand. The two steps use the warden knowledge tools:

1. **`knowledge_search`** — ask the question in the words you would use with a colleague. It
   ranks the governing corpus and returns chunk ids of the form `canon:CODE_RULES.md#5c`.
2. **`knowledge_read`** — takes one of those ids and returns that section whole. Ask for
   `neighbours` when the rule that scopes a section is likely to sit beside it.

**`knowledge_outline`** takes a document path and lists every section with its one-line
summary: the answer to "this file is 62 KB and I need one section". Outline, then read.

**An empty result is an answer.** Search refuses a question the corpus does not cover rather
than returning its ten least-bad matches, so nothing is governing a subject that comes back
empty — write what the task needs and do not infer a rule from a near miss. That refusal is
what makes the tool safe to trust, and it is why searching is instructed rather than merely
permitted. The converse does not hold: a non-empty result is not proof of coverage, so when
the hits come back but none of them addresses what was asked, that is no rule either — say so
rather than stretching the nearest one to fit.

**The chunk id is the citation.** Cite the id you read — `CODE_RULES.md §5c` in prose, the
full `canon:CODE_RULES.md#5c` where the corpus matters — so a later gate run can resolve
the claim and fail if it has moved. An uncited rule is unfalsifiable.

**Name the corpus.** `canon:…` is the fleet's law, shipped to every repository; `project:…` is
this repository's own `docs/`. Titles and glosses collide across the two — a `TESTING.md`
exists in both — so the label is the only thing distinguishing which one a hit came from, and
a canon rule cannot be amended from a consumer (§6d).

**The catalogue is the map, and it is served, not written.** The `knowledge://catalogue` resource
lists every document one index covers — the canon and this repository's own — each with the sentence
its own frontmatter uses. A host can pin it at session start, so picking a document costs no turn.

**Where no warden MCP is configured**, the same two steps run from a terminal: `warden search` ranks
the corpus and `warden outline <path>` lists a document's sections with their one-line summaries.
The fallback is the same path through the same index, reached by a different transport — not a
hand-maintained table in another file.

Reading a full document is legitimate when the whole document is the subject — a review pass,
a rewrite, or a first encounter with an unfamiliar domain. Prefer search when hunting one
rule.

---

## 2. Section Numbering Convention

Numbers are the stable citation anchor. Hundreds of cross-references across `docs/`,
`CLAUDE.md`, and `.claude/agents/` cite sections by number, so a number is a public identifier,
not a formatting choice. Titles may be reworded freely; numbers may not.

A number is extracted by splitting the heading on its first `.`:

- `## 5. Title` → `5`
- `### 5a. Title` → `5a`

**Valid number format:** a digit, followed by zero or more alphanumeric characters. Examples:
`1`, `2a`, `5c`, `10b`, `0`.

### 2a. Level-2 and Level-3 Numbering

`##` sections use sequential integers from 1, with `0` reserved for the Quick Reference.
`###` subsections prefix the parent number and add a lowercase letter:

    ## 0. Quick Reference
    ## 1. First Major Topic
    ## 2. Second Major Topic
    ### 2a. First Subsection of 2
    ### 2b. Second Subsection of 2
    ## 3. Third Major Topic

Letters continue alphabetically (`3a` … `3z`, then `3aa` if ever needed). A `## 2a.`-style
level-2 heading is legal but reserved for a related-but-distinct grouping that does not
warrant its own document.

### 2b. Forbidden Heading Patterns

These are rejected:

    ### 1.1 Title      ← ambiguous: the number reads as "1", colliding with parent ## 1
    ### 2.3 Title      ← same collision
    ### Title          ← unnumbered, so nothing can cite it
    ## Title           ← unnumbered, same problem

When a document needs to _show_ heading syntax, indent the sample by four spaces, as above.
A literal column-1 `##` inside a code fence is still parsed as a real section.

### 2c. Renumbering Is Atomic

**Renumbering a section is legal only in a commit that also updates every referrer** across
`docs/`, `CLAUDE.md`, and `.claude/agents/`. A renumber that lands without its
referrers silently routes readers to the wrong rule, which is worse than a gap.

When a pass deletes sections, **leave the gap**. Closing gaps is a separate, deliberate,
self-contained commit — never a side effect of an edit that was about something else.

---

## 3. Section Title Guidelines

A title names the concept, pattern, or mechanism the section governs — not its role in the
surrounding narrative. Target 3–8 words.

| Avoid | Prefer |
| --- | --- |
| `### Rules` | `### 3f. Barrel Export Rules and Constraints` |
| `### Setup` | `### 1a. Application Factory Setup and Configuration` |
| `### The Barrel Pattern` | `### 1a. Barrel Export and Module Catalog` |
| `### Domain Errors` | `### 1b. Domain Error Sentinels and HTTP Status Mapping` |
| `### Security headers` | `### 6b. Security-Header Middleware and Nonce Injection` |

Subsections under one parent should share a grammatical shape — all rules, or all patterns,
not a mix. Consistency is what makes a `## 0.` block scannable.

---

## 4. Frontmatter Requirements

Every `docs/` document opens with YAML frontmatter carrying exactly two fields:

    ---
    title: Short Human-Readable Title
    description: "One sentence describing what this document governs."
    ---

**Exactly two.** A field no tool reads and no reader acts on is drift waiting to happen — and both
of these are read: the title and the description are what the catalogue lists a document by (§1).

### 4a. Title Field

Short (2–5 words), title-cased, matching the document's primary concern.

### 4b. Description Field

**One prose sentence, at most 200 characters**, describing what the document governs. It is
read by a human deciding whether to open the file.

Good:

    description: "Barrel export rules, the module catalog, and leaf-versus-integration classification for every namespace."

Avoid — a keyword dump reads as noise and dates badly:

    description: "barrel exports, catalog, export check, route map, bindings, CSP nonce, partial render, design tokens"

---

## 5. Cross-Reference Format

### 5a. Inter-Document Links

Reference another document by relative markdown link, with the section number when one applies:

```markdown
See [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §2 for the Result primitive.
```

A link resolves both its path and its cited section, so a link to a deleted or renumbered
section is a defect — and a failing check wherever one runs.

**The link form is the corpus's, and a two-letter `PREFIX §N` citation form is not adopted
here.** A prefix form is path-independent, so it survives a document moving between
directories where a relative link does not — a real advantage, and the reason a repository
whose own documentation gate resolves prefixes may use one internally. The corpus declines it
for two reasons that do not apply to a single repository. Prefixes must be unique across both
directories, and `docs/` differs per repository, so nothing shipped here can prove
two documents are not claiming one prefix. And the corpus ships no resolver: a relative link
resolves in any editor and any markdown viewer, while an unresolvable prefix is a citation
that looks like evidence and points at nothing. Adopting one becomes worth revisiting when the
corpus ships a checker that resolves citations.

### 5b. Intra-Document Section References

Within one document, use the `§N` shorthand inline:

```markdown
The export validation rule (§3f) interacts with the barrel catalog (§3a).
```

### 5c. The Agent Roster Is Reconciled Both Ways

**A governing document is not registered anywhere.** Warden indexes the corpus and serves it, so a
document is found by asking a question — registering it in a hand-maintained table would add a list
that can disagree with the directory it describes, to solve a problem search already solves (§1).

**The agents `CLAUDE.md` names are a different matter, and are reconciled.** It delegates the whole
gate discipline to `cc-tester` by name and introduces the agents that route work to it, so an agent
named with no definition behind it delegates to nothing, and an agent defined and never named is one
no reader is told exists. `warden sync --check` reconciles the names in `CLAUDE.md` against
`.claude/agents/` in both directions. It measures existence only: what an agent _does_ stays
convention, enforced by the agent obeying its own stated boundaries.

### 5d. Crossing the Governance Boundary

**Links run one way: implementation may cite governance; governance never cites
implementation.** A governance document is byte-identical across every repository that clones
this corpus, so a link into a repository's own `docs/` would resolve in one repo and
dangle in the others.

An implementation document cites the portable rule it specialises and states only what is local to
the repository. Where the canon is on disk the citation may carry a relative link; where it is not,
the name and the section are the whole citation (§6d):

    See `DOC.md` §N for the rule this section specialises.

Where a governance document genuinely must name a local artifact — a register, a catalog, a
config file — it **names the path in prose and does not link it** (§8 is the standing case).
Prose survives a repository that has not written that file yet; a link does not.

`warden sync --check` enforces the direction: it reports any markdown link in the canon whose target
reaches into `docs/`. A boundary with nothing checking it is the failure this corpus refuses, and
the check is what makes this a gate step rather than a convention.

---

## 6. Document Size and Scope

### 6a. Size Targets and the Split-or-Cut Threshold

- **Target:** 200–600 lines.
- **Warn:** over 600 lines — review for a split or a cut.
- **Fail:** over 800 lines — split or cut it; this is not advisory.

Split along a boundary the codebase already uses — a runtime tier, a namespace or layer, a
lifecycle stage. Splitting a long document down the middle produces two documents nobody can
predict the contents of.

Prefer cutting to splitting. Most oversized documents are oversized because they restate
things that live elsewhere (§8), not because they govern too much.

### 6b. Subsection Citability Test

**A `###` anchor exists to be cited, not to be long.** Length is not the test — being cited
is. A three-line subsection that four other documents link to is correctly sized; a
forty-line subsection nothing references is a candidate for deletion.

Fold a subsection into its parent only when it is a true continuation of the parent's
argument. A short subsection that merely mirrors source code or another document is
**deleted**, not merged — merging preserves the duplication and hides it.

### 6c. Decisions Versus Usage — the README Boundary

`docs/` owns **decisions and constraints**: what was chosen, what is forbidden, and
why. The `README.md` beside a unit of source owns **usage and examples**: how to call the
thing, in what order, with what arguments.

**A usage sample in `docs/` is a defect unless it disambiguates a rule.** The carve-out
is real and load-bearing — an exact field name, an exact encoded output, or a flag whose
default inverts the rule is clearer shown than described. A sample that would read equally
well as "see the README" is not disambiguating anything.

### 6d. The Canon Versus This Repository's Docs

A governing document lives in one of two places, and the test between them is one question:
**would this sentence still be true in a sibling repository of the same kind?**

| Home | Holds | Where it is |
| --- | --- | --- |
| The canon | Portable rules, postures, and boundaries | Warden, in the installed package — never on disk here |
| `docs/` | Catalogs, concrete APIs, routes, bindings, local rulings | This repository, and only this one |

A rule that names a real subpath, binding, table, route, or file inventory belongs in `docs/`
by construction, however principled it sounds. A rule that would survive being pasted into a
different repository belongs in the canon.

**A local amendment to a canon rule is written in `docs/`.** The canon is not in this
repository to edit: it is served from warden, and a rule that must genuinely change is changed
in warden and released everywhere at once.

**Cite a canon document by whatever resolves where the citation lives.** A repository reading the
canon from the installed package cites it by name and section — `CODE_RULES.md §5c` — because a path
would dangle there. The repository that houses the canon on disk may link it relatively instead: the
link resolves, and the docs check holds the path against the file. Either way the name and the
section are what the citation is; the path, where one is written, is a convenience for the reader
who can follow it.

---

## 7. Quick Reference Convention

Every document begins with a `## 0. Quick Reference` immediately after the opening
blockquote, containing **one line per `##` and per `###` section**, in document order:

    ## 0. Quick Reference

    - §1 Topic One: what this section decides
    - §1a First Subsection: the specific rule it carries
    - §2 Topic Two: what this section decides

Each line orients; none restates. If a reader can act on the `## 0.` line without opening the
section, the line has absorbed the section's content and the duplication will drift. Add
sections here as they are written — a stale map is worse than none, because it is trusted by
a reader following §1's fallback path, and because the gloss is also a ranked column in the
knowledge index, so a stale one misdirects search as well.

---

## 8. Single Home Rule and the Source-of-Truth Register

**A rule lives in exactly one file. Everywhere else is a link.** When the content you are
about to write already exists in another document, in `CLAUDE.md`, or in a source file, cite
it and stop. Prefer deleting a duplicate over syncing it.

**Never put in prose what drifts** — function signatures, constant values, step counts, file
inventories. Name the file that owns them.

**Each repository keeps a source-of-truth register at
`docs/SOURCE_OF_TRUTH.md`**: a two-column table of _fact owned_ against
_file that owns it_. A source file named there is authoritative over any prose about it
anywhere in `docs/` or `CLAUDE.md`, and a governing document contradicting one is wrong
by default.

The register is implementation, not governance — its rows name real paths — so this section
carries the rule and not the rows (§5d). Two properties of a good row are worth stating,
because both are routinely got wrong:

- **A row may name more than one file when the concern genuinely spans them.** Splitting
  policy from the matchers it decides on is more honest than naming an entry point and
  sending half of its readers to the wrong place.
- **A row may name a _data_ file as authoritative over prose.** Where a config declares a
  graph, a table, or a set, the governing document cites it and enumerates none of it — a
  second copy of a list is indistinguishable from an amendment the moment the two disagree.

---

## 9. No Dated or Ticketed Content

Governing documents describe the current state of the system. They carry no history.

Forbidden: calendar dates in `YYYY-MM-DD` form, "as of" qualifiers, task or ticket
identifiers, and changelog notes (`renamed from…`, `fixed by…`, `previously…`).

A rule that needs a date to make sense is not a rule yet. `CHANGELOG.md` and git history own
the past; a governing document owns only the present.
