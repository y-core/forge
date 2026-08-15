---
title: UI Design Guidance
description: "Why the src/ui/design corpus exists, its two-tier rule model, the stable rule-id scheme, its anti-drift gate contract, and the doc boundary it holds."
---

# UI Design Guidance

> Owns the scheme the consumer-facing design corpus at `src/ui/design/` is written against: the
> two tiers a rule may occupy, the identifier every normative sentence carries, the admission
> test a candidate rule must pass, the anti-drift contract with the design gate, and forge's
> ratified dial defaults.
>
> It governs the corpus's *shape*, never its content. No design rule is stated here.
>
> Defers to: [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) for the `ui/core` component
> contract and the class utilities; [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) for the
> browser tier and the SSR boundary; [`AGENT_GUIDE.md`](../governance/AGENT_GUIDE.md) for the governing-doc
> format this document is itself subject to; `src/ui/README.md` for every component's props,
> signature, and worked usage.

---

## 0. Quick Reference

- §1 Corpus Purpose and Composition Gap: what a correct-but-low-craft UI looks like, and why the API reference cannot close it
- §1a Termination in a Forge Primitive: the property that makes most rules grep-checkable
- §2 Two Rule Tiers — Floor and Defaults: the only two strengths a corpus rule may have
- §2a Floor — Verify and Refuse: bare imperatives, split into the two halves
- §2b Defaults — Rebuttable Aesthetic Guidance: the literal `Default:` opener and the mandatory override condition
- §2c Override Authority — the Written Brief: who may rebut a Default, and who may not
- §3 Rule Identifier Scheme: the corpus's stable citation anchor
- §3a Marker Syntax and Placement: the trailing HTML comment, one per normative sentence
- §3b Identifier Stability and Citation: ids are never renamed, never renumbered, never reused
- §3c The Forge-Primitive Admission Test: what a candidate rule must name to be admitted
- §4 Anti-Drift Contract with the Design Gate: the corpus may not describe an API forge lacks
- §4a Gate Enforcement Across Both Tiers: the gate's second direction, and why a gated rule is not thereby a Floor rule
- §5 Three-Way Documentation Boundary: which of three homes owns a given statement
- §5a Routing Rule for a New Design Rule: design rules and anti-patterns never land in `.decisions/`
- §6 Format Exemption and This Document's Scope: the corpus is exempt; this file is not
- §7 Sourcing Constraint and Attribution: facts are usable, prose is not, credit is owed
- §7a Attribution Placement — Corpus Footer and File Footers: where a `## Sources` section belongs, and where one would be noise
- §8 Dial Defaults — Density, Variance, Motion: forge's ratified app-UI setting on three scales

---

## 1. Corpus Purpose and Composition Gap

Forge's `ui` namespace publishes a large surface — the `@y-core/forge/ui/core` server-rendered
components, the bound variants in `@y-core/forge/ui/controls`, the application shell in
`@y-core/forge/ui/chrome`, a semantic token system in `@y-core/forge/ui/assets`, and the mount
controllers in `@y-core/forge/ui/client`. Every one of them is documented for *calling*.

None of it is documented for *composing*. This is the gap the corpus at `src/ui/design/` exists
to close, and it is not a hypothetical one: an agent handed only the API reference can wire every
component correctly and still ship output that type-checks, passes its tests, and reads as a
defect. The corpus's job is to name those patterns; `src/ui/design/floor.md` and
`src/ui/design/tells.md` own the catalogue, and this document does not carry a second copy of it
(§5a).

Its job is **not** to restate design literature. Reproducing a chapter on visual hierarchy
produces prose an agent cannot act on and a gate cannot check.

### 1a. Termination in a Forge Primitive

The corpus's method is a single move applied everywhere: **every abstract principle terminates in
a named forge primitive** — a component, a semantic token, a class utility, or a state attribute.

"Establish a clear visual hierarchy" terminates in nothing and is therefore unactionable.
"Body copy uses the muted foreground token; the surface's default foreground token is reserved
for the primary line" terminates in two named tokens, and a reviewer can grep for the literal
that violates it.

This is what makes the majority of corpus rules mechanically checkable rather than merely
persuasive, and it is the property the admission test in §3c enforces.

---

## 2. Two Rule Tiers — Floor and Defaults

A corpus rule occupies exactly one of two tiers. There is no third strength, and a rule that
cannot be placed in one of the two is not yet a rule.

### 2a. Floor — Verify and Refuse

**Tier 1, the Floor, is invariant.** A Floor rule is never overridden, by anyone, for any brief.
Floor rules are mechanically checkable, anchored to a forge primitive, and stated as bare
imperatives — no hedging, no "prefer", no "consider".

The Floor is split into two halves, and the split is structural rather than cosmetic:

- **Verify** — an obligation. Something that must be present, satisfied, or measured before the
  work is done.
- **Refuse** — a prohibition. Something that must never appear in output, regardless of what was
  asked for.

The two halves are read at different moments. Verify is a pre-completion pass; Refuse is a
constraint held during generation. Interleaving them produces a list that serves neither.

### 2b. Defaults — Rebuttable Aesthetic Guidance

**Tier 2, the Defaults, are rebuttable.** They carry forge's aesthetic position, including the
catalogue of AI tells — the recurring output patterns that mark work as machine-composed rather
than designed.

Every Default rule obeys two formal requirements:

1. It opens with the literal token `Default:`. The token is what distinguishes a rebuttable
   position from a Floor imperative when the two sit on adjacent lines, and it is what a reader
   scanning for "what may I change" matches on.
2. It ends with its **override condition** — the circumstance under which departing is correct.
   A Default with no stated override condition is either a Floor rule that was misfiled, or a
   preference with no argument behind it. Both are defects.

### 2c. Override Authority — the Written Brief

A Default is overridable **only by an explicit written brief from the consumer**.

It is never overridable by the agent's own aesthetic preference, by a judgement that the default
looks plain in this instance, or by inference from the surrounding code. An agent that rebuts a
Default without a brief has not exercised judgement; it has deleted the guidance.

The Floor (§2a) admits no override at all, brief or otherwise. A brief that contradicts a Floor
rule is a brief that is refused.

---

## 3. Rule Identifier Scheme

Every normative sentence in the corpus carries a stable identifier. The scheme is the corpus's
load-bearing mechanism: it is what lets a checklist item, a detector finding, and a review report
all point at the same sentence, exactly as `§N` numbers are cited across `.decisions/`.

### 3a. Marker Syntax and Placement

The identifier is written as a trailing HTML comment on the sentence it governs:

    <!-- rule:forge-ui-color-token-only -->

Form: kebab-case, always prefixed `forge-ui-`, unique corpus-wide.

An HTML comment is the chosen carrier for one reason — it is invisible when the markdown is
rendered, so a human reader sees clean prose, while `rg 'rule:forge-ui-'` enumerates the entire
normative surface in one pass. A visible identifier would tax every human read of the corpus to
serve a tooling need.

One marker per normative sentence. A paragraph of three rules carries three markers, because a
finding that cites the paragraph tells a reader which paragraph, not which rule.

### 3b. Identifier Stability and Citation

**Identifiers are never renamed, never renumbered, and never reused.** An id is a public
citation anchor the moment it ships, and it is cited from outside the corpus — by checklists, by
detector output, and by review reports that outlive the phrasing of the sentence.

Consequences, and they are the same ones [`AGENT_GUIDE.md`](../governance/AGENT_GUIDE.md) §2c draws for
section numbers:

- The sentence may be reworded freely; the id may not change.
- A deleted rule leaves its id retired. Reassigning a retired id to a different rule silently
  redirects every existing citation to the wrong sentence, which is worse than a dangling one.
- A rule that splits in two keeps the original id on the half that inherits its meaning, and
  mints a new id for the other.

Ids are unordered. They carry no sequence and no hierarchy — grouping is the corpus's headings'
job, not the identifier's.

### 3c. The Forge-Primitive Admission Test

**A rule that cannot name a forge component, token, utility, or class does not belong in the
corpus.** This is the admission test, and it is applied before an id is minted.

Material that fails it is not deleted — it is a general design principle, true and useful, that
forge has no standing to restate (§7). It belongs in the corpus's `## Sources` footer, credited
to whoever argued it first.

The test's value is that it bounds the corpus. Without it, a corpus about composing forge
components drifts into a design textbook that duplicates its own sources, cannot be checked, and
grows without a stopping condition.

---

## 4. Anti-Drift Contract with the Design Gate

The corpus makes claims about forge's API on nearly every line — it names components, token
names, variant names, and utility signatures. Those claims drift the moment the API moves, and a
corpus that teaches a component forge does not have is worse than one that teaches nothing,
because it is followed.

The contract is one sentence: **the corpus may not describe an API forge does not have.**

Enforcement is a gate step. `src/pkg/gate/checks/design.ts` owns the policy — what is asserted, what
fails, in what order, with what message — and `src/pkg/gate/checks/design-parse.ts` owns the matchers it
decides on: how a claim is extracted from prose, and how it is resolved against forge's real
exports. The split is the one described for the barrel and namespace-graph checks in
[`AGENT_GUIDE.md`](../governance/AGENT_GUIDE.md) §8.

**Neither the assertion list nor its failure modes are restated here.** Restating a check list in
prose produces a second copy that is indistinguishable from an amendment the first time the two
disagree. A reader asking "what exactly is checked" reads the script; this section owns only the
contract the script exists to uphold, and the fact that the corpus is subject to it.

Registration of those two files in the source-of-truth register is a separate concern, owned by
[`AGENT_GUIDE.md`](../governance/AGENT_GUIDE.md) §8.

### 4a. Gate Enforcement Across Both Tiers

Two properties of that gate step are not derivable from the contract sentence above, and a reader
who assumes either one wrongly draws a conclusion about rule strength that is not there.

**The gate runs in both directions.** The corpus is checked against forge's API, and forge's own
source is checked against the corpus — **all of it that renders markup, not `src/ui/` alone**. The
second direction is why a rule the corpus publishes for consumers can fail forge's own build: forge
is held to the guidance it ships, and its worked examples most tightly of all, because an example
that contradicts the rule beside it teaches the contradiction rather than the rule.

The scope is the whole source tree because the corpus states rules about *markup*, and forge renders
markup outside `ui/` — `logging/show/` is an entire surface. Narrowed to `ui/`, the second direction
was a claim wider than the check behind it, and the gap was not hypothetical. Where a rule is
genuinely local to one directory, the finder scopes itself, because that scoping is part of what the
rule means rather than a property of where the walk happens to start.

**A gated rule is not thereby a Floor rule.** Which rules are checked statically is decided by
mechanical checkability (§1a) alone, so the enforced set spans both tiers, and a Tier-2 Default that
happens to be greppable is checked exactly as a Floor rule is. That does not promote it. A gated
Default remains rebuttable in the sense §2b defines: `src/pkg/gate/checks/design-parse.ts` gives every rule a
per-site suppression carrying a **mandatory written reason**, which is the form §2c's written brief
takes inside forge's own source — stated, attached to the line it excuses, and reviewable, rather
than inferred or silent.

The suppression mechanism itself is uniform across rule ids; the tiers are not encoded in it, and
could not usefully be. What §2a and §2c decide is who may write one and on what grounds — a stated
reason for a Default, and nothing at all for a Floor rule, where a suppression is a defect to remove
rather than an override to accept.

Which rules are in the enforced set, what each one matches, and the marker's exact syntax are the
script's, per §4's non-restatement rule.

---

## 5. Three-Way Documentation Boundary

Three homes exist for a statement about forge's UI, and the boundary between them is the section
other documents will cite most. Each answers a different question:

| Home | Owns | The question it answers |
|---|---|---|
| `.decisions/` | forge-**internal** constraints | What must forge's own source do? |
| `src/ui/README.md` | **API usage** | How do I call this, with what arguments? |
| `src/ui/design/` | consumer-facing **design judgement** | Which one should I call, and what does good look like? |

The distinction between the second and third is the one that is actually hard, so state it
concretely: that a component accepts a given variant is API usage. That one of those variants is
the right choice for a destructive confirmation, and that reaching for a different one signals
severity the interaction does not carry, is design judgement.

The first row is unchanged from [`AGENT_GUIDE.md`](../governance/AGENT_GUIDE.md) §6c — it is restated here
only because the three-way split is unreadable with one row missing.

### 5a. Routing Rule for a New Design Rule

**A new design rule or anti-pattern goes to `src/ui/design/`, never to `.decisions/`.**

The rule is stated as an absolute because the failure it prevents is silent. A design rule
written into a governing document is read by forge's own contributors and never by the consumers
it was written for, while the corpus that should carry it develops a gap nobody notices.

The reverse direction holds too: a constraint on forge's own source — what a component must
render, what it must never accept — is a governing-document rule that does not belong in a
consumer-facing corpus, however design-shaped it sounds.

---

## 6. Format Exemption and This Document's Scope

`src/pkg/gate/checks/docs.ts`, configured by `config/steps.ts`, scopes to `.decisions/`, `CLAUDE.md`, the root `README.md`, every
`src/**/README.md`, and `.claude/agents/`. The corpus at `src/ui/design/` matches none of those.

Therefore:

- **The corpus is exempt** from the governing-doc format. No `## N.` numbering, no `## 0. Quick
  Reference`, no line cap. Its files are organized for a reader learning to compose a UI, in
  whatever shape serves that; its citation anchors are the rule ids of §3, not section numbers.
- **This document is fully subject** to it. Numbered headings, the Quick Reference, the
  frontmatter fields, the size thresholds, the ban on dated and ticketed content — all of it
  applies here, and the gate enforces it here.

The exemption is stated explicitly because it is the question a reader arrives with. Left unsaid,
the reasonable inference is that the corpus was written to the governing-doc format and failed
to follow it.

The exemption is from the `validate-docs` step only. The corpus's own gate step (§4) has no
equivalent carve-out.

---

## 7. Sourcing Constraint and Attribution

The corpus is **written fresh**. It is not assembled from, and does not paraphrase closely, any
existing design text.

The line runs between facts and expression:

- **Facts are usable.** Principles and numeric constants are not ownable, so the corpus states
  them plainly wherever one anchors a rule. The values themselves are the corpus's —
  `src/ui/design/floor.md` carries each one beside the rule it anchors, and repeating them here
  would put a second copy under a document the design gate does not walk (§5a).
- **Source prose is not.** No sentence, phrasing, table, or ordered structure is carried over
  from a source. Where a source's argument is used, it is re-derived against forge's primitives
  (§1a), which is a rewrite in the only sense that matters.

**Attribution is owed** in the corpus's `## Sources` footer — every text whose reasoning shaped a
rule, credited by name. The footer is also where material that fails the admission test lands
(§3c).

This constraint exists because forge is a published npm package. The corpus ships inside it, to
every consumer, under forge's license. Guidance that would be merely awkward in an internal
document is a licensing defect when it is distributed.

### 7a. Attribution Placement — Corpus Footer and File Footers

**Attribution is owed per corpus, not per file.** The corpus's entry point carries the `## Sources`
footer that credits the texts whose reasoning shaped its rules, and that footer covers every file,
because the re-derivation those rules went through (§7) is corpus-wide rather than local to a page.

**A file carries its own footer only when it rests on a source of its own that the corpus-level
credit does not cover** — a named third-party palette a forge stylesheet resamples, with its version
and license, rather than an argument re-derived in forge's terms. The colour reference is the one
file in that position, because its subject is values forge carries rather than judgements forge
re-argued.

**A file with no such source carries no footer, and that is the correct state rather than a gap.**
A `## Sources` section listing what a page did not draw on credits nobody, and a corpus where every
file carries one teaches a reader to skip the two that mean something. Adding a footer is warranted
by a source, never by symmetry.

---

## 8. Dial Defaults — Density, Variance, Motion

Forge ratifies three dials, each on a 1–10 scale, and sets its app-UI defaults:

| Dial | Default | What it sets |
|---|---|---|
| Density | 5 | How much information occupies a given area, and how tight the spacing scale runs |
| Variance | 4 | How much a surface departs from the plainest arrangement that works |
| Motion | 3 | How much movement the interface carries, via the `@y-core/forge/ui/client` transition states |

These are deliberately restrained relative to the design sources the corpus credits, and the
reason is a difference in target rather than a disagreement about taste. Most published design
guidance is shaped by marketing surfaces — a page seen once, where variance earns attention and
motion rewards a scroll. **Forge's primary target is product and app UI**: surfaces seen many
times a day, by a user who came to complete a task. There, variance costs recognition and motion
costs time.

Marketing surfaces are a secondary target, and they are the standing case for a written brief
(§2c) raising all three.

The dials are Defaults, not Floor — each is rebuttable per §2b, and each rebuttal is a brief,
not a preference.
