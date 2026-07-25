---
title: Governing Document Guide
description: "How .decisions/ documents are structured, numbered, sized, cross-referenced, and kept free of duplicated or drifting content."
---

# Governing Document Guide

> This guide is the authoritative source for how `.decisions/` documents are written and
> structured. It governs form — numbering, frontmatter, size, cross-references, and where a
> rule is allowed to live. It does not govern any domain; every domain rule belongs to the
> document that owns it.
>
> All new and updated governing documents must follow these rules.
> Mechanically checkable subsets of §2, §4, §5, §6a, and §9 are enforced by
> `scripts/validate-docs.ts`.

---

## 0. Quick Reference

- §1 Document Access Path: Guide Index → `## 0.` → target section, using plain `Read`
- §2 Section Numbering Convention: why numbers exist and what the parser accepts
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
- §5c Guide Index Registration: every document is reachable from `CLAUDE.md`
- §6 Document Size and Scope: what belongs in a governing document at all
- §6a Size Targets and the Split-or-Cut Threshold: 200–600 target, 800 hard fail
- §6b Subsection Citability Test: a `###` exists to be cited, not to be long
- §6c Decisions Versus Usage — the README Boundary: examples live in `src/{ns}/README.md`
- §7 Quick Reference Convention: one line per `##` and `###`
- §8 Single Home Rule and Source-of-Truth Register: where each fact is allowed to live
- §9 No Dated or Ticketed Content: no dates, task IDs, or changelog notes

---

## 1. Document Access Path

Governing documents are plain markdown, read with `Read` and searched with `Grep`. There is
no section-server and no special access tool.

The intended path to a rule is three steps:

1. **Guide Index in `CLAUDE.md`** — one line per document; picks the document.
2. **`## 0. Quick Reference`** — one line per section; picks the section.
3. **The target section** — read it, and follow its links rather than re-deriving its rules.

This path is why §7 mandates a complete Quick Reference: with no external index, that block
*is* the index. A document whose `## 0.` omits sections is unnavigable, not merely untidy.

Reading a full document is legitimate when the whole document is the subject — a review pass,
a rewrite, or a first encounter with an unfamiliar domain. Prefer the path above when hunting
one rule.

---

## 2. Section Numbering Convention

Numbers are the stable citation anchor. Roughly two hundred cross-references across
`.decisions/`, `CLAUDE.md`, and `.claude/agents/` cite sections by number, so a number is a
public identifier, not a formatting choice. Titles may be reworded freely; numbers may not.

`scripts/validate-docs.ts` extracts the number by splitting the heading on its first `.`:

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

These are rejected by `validate-docs.ts`:

    ### 1.1 Title      ← ambiguous: the number reads as "1", colliding with parent ## 1
    ### 2.3 Title      ← same collision
    ### Title          ← unnumbered, so nothing can cite it
    ## Title           ← unnumbered, same problem

When a document needs to *show* heading syntax, indent the sample by four spaces, as above.
A literal column-1 `##` inside a code fence is still parsed as a real section.

### 2c. Renumbering Is Atomic

**Renumbering a section is legal only in a commit that also updates every referrer** across
`.decisions/`, `CLAUDE.md`, and `.claude/agents/`. A renumber that lands without its
referrers silently routes readers to the wrong rule, which is worse than a gap.

When a pass deletes sections, **leave the gap**. Closing gaps is a separate, deliberate,
self-contained commit — never a side effect of an edit that was about something else.

---

## 3. Section Title Guidelines

A title names the concept, pattern, or mechanism the section governs — not its role in the
surrounding narrative. Target 3–8 words.

| Avoid | Prefer |
|---|---|
| `### Rules` | `### 3f. Barrel Export Rules and Constraints` |
| `### Setup` | `### 1a. createApp Factory Setup and Configuration` |
| `### The mod.ts Pattern` | `### 1a. mod.ts Barrel Export and Namespace Catalog` |
| `### Domain Errors` | `### 1b. Domain Error Sentinels and HTTP Status Mapping` |
| `### Security headers` | `### 6b. createSecurityHeaders CSP Nonce Injection` |

Subsections under one parent should share a grammatical shape — all rules, or all patterns,
not a mix. Consistency is what makes a `## 0.` block scannable.

---

## 4. Frontmatter Requirements

Every `.decisions/` document opens with YAML frontmatter carrying exactly two fields:

    ---
    title: Short Human-Readable Title
    description: "One sentence describing what this document governs."
    ---

### 4a. Title Field

Short (2–5 words), title-cased, matching the document's primary concern.

### 4b. Description Field

**One prose sentence, at most 200 characters**, describing what the document governs. It is
read by a human deciding whether to open the file.

Good:

    description: "Barrel export rules, the namespace catalog, and leaf-versus-integration classification for every forge namespace."

Avoid — a keyword dump reads as noise and dates badly:

    description: "barrel exports, mod.ts pattern, namespace catalog, validate-exports, app.map, bindings, CSP nonce, HTMX partial render, Tailwind tokens"

---

## 5. Cross-Reference Format

### 5a. Inter-Document Links

Reference another governing document by relative markdown link, with the section number when
one applies:

```markdown
See [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) §2 for the Result primitive.
```

`validate-docs.ts` resolves both the path and the cited section, so a link to a deleted or
renumbered section fails the gate.

### 5b. Intra-Document Section References

Within one document, use the `§N` shorthand inline:

```markdown
The export validation rule (§3f) interacts with the barrel catalog (§3a).
```

### 5c. Guide Index Registration

Every `.decisions/` document must appear in the Guide Index in `CLAUDE.md` with a one-line
description. The index and the directory must agree in both directions — a document missing
from the index, or an index row naming a file that does not exist, fails the gate.

---

## 6. Document Size and Scope

### 6a. Size Targets and the Split-or-Cut Threshold

- **Target:** 200–600 lines.
- **Warn:** over 600 lines — review for a split or a cut.
- **Fail:** over 800 lines — split or cut it; this is enforced, not advisory.

Split along a boundary the codebase already uses — a runtime tier, a namespace, a lifecycle
stage. Splitting a long document down the middle produces two documents nobody can predict
the contents of.

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

`.decisions/` owns **decisions and constraints**: what was chosen, what is forbidden, and
why. `src/{ns}/README.md` owns **usage and examples**: how to call the thing, in what order,
with what arguments.

**A usage sample in `.decisions/` is a defect unless it disambiguates a rule.** The carve-out
is real and load-bearing — an exact field name, an exact encoded output, or a flag whose
default inverts the rule is clearer shown than described. A sample that would read equally
well as "see the README" is not disambiguating anything.

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
sections here as they are written — a stale map is worse than none, because it is trusted.

---

## 8. Single Home Rule and Source-of-Truth Register

**A rule lives in exactly one file. Everywhere else is a link.** When the content you are
about to write already exists in another document, in `CLAUDE.md`, or in a source file named
below, cite it and stop. Prefer deleting a duplicate over syncing it.

**Never put in prose what drifts** — function signatures, constant values, step counts, file
inventories. Name the file that owns them.

Facts owned by source, never restated in `.decisions/`:

| Owns | File |
|---|---|
| Export subpath names | `package.json` `exports` |
| Verification gate steps | `package.json` `scripts.check` |
| Side-effectful modules | `package.json` `sideEffects` |
| CSRF and honeypot field names | `src/form/constants.ts` |
| Per-namespace export lists | `src/{ns}/mod.ts` |
| `lib` and `types` configuration | `tsconfig.json` |
| Barrel rules as *enforced* | `scripts/validate-exports.ts` |

Every `@y-core/forge/<subpath>` written anywhere in the documentation set is checked against
`package.json` `exports`; an unresolvable subpath fails the gate.

---

## 9. No Dated or Ticketed Content

Governing documents describe the current state of the system. They carry no history.

Forbidden, and checked: calendar dates in `YYYY-MM-DD` form, "as of" qualifiers, task or ticket
identifiers, and changelog notes ("renamed from…", "fixed by…", "previously…").

A rule that needs a date to make sense is not a rule yet. `CHANGELOG.md` and git history own
the past; a governing document owns only the present.
