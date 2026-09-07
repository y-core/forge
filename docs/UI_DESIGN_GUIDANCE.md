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
> It governs the corpus's _shape_, never its content. No design rule is stated here.
>
> Defers to: [`UI_SSR_COMPONENTS.md`](./UI_SSR_COMPONENTS.md) for the `ui/core` component
> contract; [`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) for the class utilities and the
> conflict table; [`UI_CLIENT_RUNTIME.md`](./UI_CLIENT_RUNTIME.md) for the
> browser tier and the SSR boundary; [`AGENT_GUIDE.md`](../warden/canon/shared/AGENT_GUIDE.md) for the governing-doc
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
- §3b Identifier Stability and Citation: ids are never renamed, never renumbered, never reused; the retired list
- §3c The Forge-Primitive Admission Test: what a candidate rule must name to be admitted
- §4 Anti-Drift Contract with the Design Gate: the corpus may not describe an API forge lacks
- §4a Gate Enforcement Across Both Tiers: the gate's second direction, and why a gated rule is not thereby a Floor rule
- §4b Two Enforcement Mechanisms: the check step and the oxlint plugin, and the two registers that keep them honest
- §5 Three-Way Documentation Boundary: which of three homes owns a given statement
- §5a Routing Rule for a New Design Rule: design rules and anti-patterns never land in `docs/`
- §6 The Corpus Is Subject to the Governing-Doc Format: numbering and a Quick Reference, because warden reads both
- §7 Sourcing Constraint and Attribution: facts are usable, prose is not, credit is owed
- §7a Attribution Placement — Corpus Footer and File Footers: where a `## Sources` section belongs, and where one would be noise
- §8 Dial Defaults — Density, Variance, Motion: forge's ratified app-UI setting on three scales

---

## 1. Corpus Purpose and Composition Gap

Forge's `ui` namespace publishes a large surface — the `@y-core/forge/ui/core` server-rendered
components, the bound variants in `@y-core/forge/ui/controls`, the application shell in
`@y-core/forge/ui/chrome`, a semantic token system in `@y-core/forge/ui/assets`, and the mount
controllers in `@y-core/forge/ui/client`. Every one of them is documented for _calling_.

None of it is documented for _composing_. This is the gap the corpus at `src/ui/design/` exists
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
Floor rules are checkable against a named forge primitive by a reviewer (§1a) — not necessarily by
a command — anchored to that primitive, and stated as bare imperatives — no hedging, no "prefer",
no "consider".

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
all point at the same sentence, exactly as `§N` numbers are cited across `docs/`.

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

Consequences, and they are the same ones [`AGENT_GUIDE.md`](../warden/canon/shared/AGENT_GUIDE.md) §2c draws for
section numbers:

- The sentence may be reworded freely; the id may not change.
- A deleted rule leaves its id retired. Reassigning a retired id to a different rule silently
  redirects every existing citation to the wrong sentence, which is worse than a dangling one.
- A rule that splits in two keeps the original id on the half that inherits its meaning, and
  mints a new id for the other.

Ids are unordered. They carry no sequence and no hierarchy — grouping is the corpus's headings'
job, not the identifier's.

**The corpus's section numbers carry the same obligation, for the same reason.** They are never
renamed, never renumbered, and never reused once published, exactly as
[`AGENT_GUIDE.md`](../warden/canon/shared/AGENT_GUIDE.md) §2c requires of every governing
document's. A section number is the address `knowledge_read` resolves, so renumbering silently
redirects a saved citation to a different chunk. A new section appends, or takes a `###` child
number under the section it belongs to; a deleted one leaves its number retired.

**Retired ids.** `forge-ui-viewport-units` is retired. `h-screen` and `w-screen` are two class
names, which is a restriction list rather than a rule that admits judgement, and the guidance prose
in `floor.md` states it as well without one. The id stays retired rather than reassigned: a citation
that outlived it lands on nothing rather than on a different sentence.

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

Enforcement is a gate step. `warden/src/checks/design.ts` owns the policy — what is asserted, what
fails, in what order, with what message — and `src/tooling/gate/checks/design-parse.ts` owns the matchers it
decides on: how a claim is extracted from prose, and how it is resolved against forge's real
exports. The split is the one described for the barrel and namespace-graph checks in
[`AGENT_GUIDE.md`](../warden/canon/shared/AGENT_GUIDE.md) §8.

**Neither the assertion list nor its failure modes are restated here.** Restating a check list in
prose produces a second copy that is indistinguishable from an amendment the first time the two
disagree. A reader asking "what exactly is checked" reads the script; this section owns only the
contract the script exists to uphold, and the fact that the corpus is subject to it.

Registration of those two files in the source-of-truth register is a separate concern, owned by
[`AGENT_GUIDE.md`](../warden/canon/shared/AGENT_GUIDE.md) §8.

### 4a. Gate Enforcement Across Both Tiers

Two properties of that gate step are not derivable from the contract sentence above, and a reader
who assumes either one wrongly draws a conclusion about rule strength that is not there.

**Enforcement runs in both directions.** The corpus is checked against forge's API by
`validate-design`, and forge's own source is checked against the corpus by the `lint` step — **all
of it that renders markup, not `src/ui/` alone**. The
second direction is why a rule the corpus publishes for consumers can fail forge's own build: forge
is held to the guidance it ships, and its worked examples most tightly of all, because an example
that contradicts the rule beside it teaches the contradiction rather than the rule.

The scope is the whole source tree because the corpus states rules about _markup_, and forge renders
markup outside `ui/` — `logging/show/` is an entire surface. Narrowed to `ui/`, the second direction
was a claim wider than the check behind it, and the gap was not hypothetical. Where a rule is
genuinely local to one directory, an `overrides` entry in `.oxlintrc.json` scopes it, because that
scoping is part of what the rule means rather than a property of where a walk happens to start.

**An enforced rule is not thereby a Floor rule.** Which rules are checked statically is decided by
mechanical checkability (§1a) alone, so the enforced set spans both tiers, and a Tier-2 Default that
the AST reveals is checked exactly as a Floor rule is. That does not promote it. An enforced
Default remains rebuttable in the sense §2b defines: every rule takes a per-site
`oxlint-disable-next-line forge/<key> -- <why>` carrying a **mandatory written reason**, which is the
form §2c's written brief takes inside forge's own source — stated, attached to the line it excuses,
and reviewable, rather than inferred or silent. `forge/suppression-needs-reason` is what makes the
reason mandatory rather than customary.

The suppression mechanism itself is uniform across rule ids; the tiers are not encoded in it, and
could not usefully be. What §2a and §2c decide is who may write one and on what grounds — a stated
reason for a Default, and nothing at all for a Floor rule, where a suppression is a defect to remove
rather than an override to accept.

Which rules are in the enforced set and what each one matches are the plugin's, per §4's
non-restatement rule.

### 4b. Two Enforcement Mechanisms

A corpus rule is enforced by one of two mechanisms, and which one is a property of **what the rule
has to read** rather than of its tier — or, as this was cut when the plugin's only reader was a
class-literal visitor, of whether its subject is markup or a class string.

**forge's oxlint plugin** — `@y-core/forge/tooling/lint`, run by the `lint` step — owns every rule a
**parsed file settles**. That is both families: a class string, and markup structure. A tag name, an
attribute, an ancestor chain and the body between two tags are all things `JSXOpeningElement` and a
parent walk give directly, so the earlier split bought a hand-written scanner nothing the parser was
not already offering. The parser is also what makes a rule precise: a CSS property name in a
generated table, a sentence containing the word `prose`, and a class name quoted in an assertion are
not class strings, because the parser says they are not. A plugin rule's per-site suppression is
`oxlint-disable-next-line forge/<key> -- <why>`, and because the rule is a lint rule it is also
eligible for a fixer — a `CheckStep` can never carry one.

**`validate-contrast`** owns the one rule no source text states: `forge-ui-contrast-floor` is
measured off resolved colours, so it reads no `.tsx` at all.

**What a plugin rule cannot own** is a rule needing more than one file — an import graph, an export
map, a compiled stylesheet, a README held against a barrel. oxlint judges one file at a time, which
is why those checks stay gate steps and why `validate-design` still runs: it holds the corpus
against forge's API, and the two registers against the plugin, neither of which is a per-file
question.

The plugin's rule key is the corpus id minus its `forge-ui-` prefix, derived in both directions and
never hand-kept. **Two registers name the mechanism, one per rule family**, and an author adding a
rule declares its enforcer in the register that already holds the rule:

- `src/tooling/lint/design-rules.ts` routes every corpus rule, through `RULE_ENFORCER`. It
  imports nothing, deliberately: the plugin reaches it through `lint/report.ts` and ships as raw
  TypeScript, so a module it loads may not drag `tailwindcss` or `oxlint` in behind it
  ([`NAMESPACES.md`](./NAMESPACES.md) §3c).
- `src/tooling/lint/modern-css-rules.ts` routes every modern-platform rule, through the
  optional `enforcer` field on the rule's own row — absent meaning the modern-CSS check's own
  detector. `design-rules.ts` names no platform rule at all.

`validate-design` holds each register's rows against the mechanism they name — so deleting a plugin
rule fails the gate by name exactly as deleting a detector did — and holds the plugin in the other
direction against both registers together: a rule the plugin registers that neither register routes
fails too, because its findings would print an id no register states. The exemptions are the plugin
rules that state no corpus rule at all — `suppression-needs-reason` and `data-slot-before-spread`,
each named in `design.ts` with its reason, neither having a corpus id to route.

That guarantee is bounded by what "enabled" means: the check takes the union of the top-level `rules`
block and every `overrides` entry, so a rule enabled only in an override counts — and a rule turned
off in one still reads as enabled, because the question asked is whether it is on anywhere, not
everywhere.

**Which rules sit on which side is not restated here**, for the reason §4 gives: each register is
one file, and a second copy in prose is indistinguishable from an amendment the first time the two
disagree.

Two of the plugin's rules resolve a class against the design system itself — which utility roots take
a spacing value, which take a colour, and what steps the scale offers. Those facts are generated from
the compiled stylesheet into `src/tooling/lint/data/design-scale.ts` and held there by
`validate-design-scale`, on the same drift contract `validate-class-groups` holds `cn`'s table to.

**The two derivations are parallel and are deliberately not folded into one.** Both read the same
compiled design system, which is the source of truth they actually share; but the other one's
output is `cn`'s conflict model ([`UI_CLASS_COMPOSITION.md`](./UI_CLASS_COMPOSITION.md) §1c), and
coupling the linter's data to it would make each a hostage of the other's changes.

**`spacing-scale-only` reports an arbitrary value only where a scale step states that exact
length.** `p-[8px]` is reported because `p-2` is the same eight pixels; `p-[7px]` is not, because no
step is seven. That is the rule as it has always been enforced, and it is the promise worth making:
a suggestion the author can act on. A rule that also flagged the off-scale value would be a
different rule, arguing that off-scale lengths are wrong in themselves — a case the corpus does not
make and this one does not pretend to.

**A class list bound to a module-scope `const` and passed by name is judged where the name is
used.** Forge writes most of its recipes that way, so a plugin that read only inline literals was
blind to the majority of the class strings it exists to check. An initializer that is already a
class position of its own — `const R = cva(…)` — is judged where it is written and not a second
time through the name. A `const` declared inside a function is not resolved: a class list written
there is not the shared recipe this reaches for.

---

## 5. Three-Way Documentation Boundary

Three homes exist for a statement about forge's UI, and the boundary between them is the section
other documents will cite most. Each answers a different question:

| Home | Owns | The question it answers |
| --- | --- | --- |
| `docs/` | forge-**internal** constraints | What must forge's own source do? |
| `src/ui/README.md` | **API usage** | How do I call this, with what arguments? |
| `src/ui/design/` | consumer-facing **design judgement** | Which one should I call, and what does good look like? |

The distinction between the second and third is the one that is actually hard, so state it
concretely: that a component accepts a given variant is API usage. That one of those variants is
the right choice for a destructive confirmation, and that reaching for a different one signals
severity the interaction does not carry, is design judgement.

The first row is unchanged from [`AGENT_GUIDE.md`](../warden/canon/shared/AGENT_GUIDE.md) §6c — it is restated here
only because the three-way split is unreadable with one row missing.

### 5a. Routing Rule for a New Design Rule

**A new design rule or anti-pattern goes to `src/ui/design/`, never to `docs/`.**

The rule is stated as an absolute because the failure it prevents is silent. A design rule
written into a governing document is read by forge's own contributors and never by the consumers
it was written for, while the corpus that should carry it develops a gap nobody notices.

The reverse direction holds too: a constraint on forge's own source — what a component must
render, what it must never accept — is a governing-document rule that does not belong in a
consumer-facing corpus, however design-shaped it sounds.

---

## 6. The Corpus Is Subject to the Governing-Doc Format

`warden/src/checks/docs.ts`, configured by `config/steps.ts`, scopes to `docs/`, `CLAUDE.md`, the
root `README.md`, every `src/**/README.md`, `.claude/agents/`, the fleet canon, and the corpus at
`src/ui/design/`. The last two are `extraDirs` entries marked `numbered`, which is what puts a tree
outside `docs/` under the whole format rather than the per-line prose rules alone.

**The corpus is fully subject to that format** — `## N.` numbered headings, a `## 0. Quick
Reference` naming every one of them, the frontmatter fields, and the size thresholds. Exactly as
this document is, and the gate enforces both.

The reason is retrieval, not house style. Warden indexes the corpus, and the Quick Reference line is
where a section's **gloss** comes from: the one-line summary a search result prints under the
heading trail, and a ranked column in its own right, weighted far above the section's body text. A
corpus with no Quick Reference competes on four of five ranked columns and prints a bare heading to
every reader who searches it.

The size thresholds bind for the same reason. A section is what `knowledge_read` returns whole, so a
section too large to be an answer is a section nobody can usefully be handed — and a section that
cannot be summarised in one Quick Reference line is carrying more than one idea and wants `###`
children. The Quick Reference is therefore the forcing function on size, not a description of it.

A numbered section and a rule id (§3) address different things and neither replaces the other: **a
rule id names a sentence; a section number names a chunk.** A finding cites the sentence it rests
on. Only the section number is addressable by `knowledge_read`.

None of this is a constraint on how the corpus reads. Its files are still organized for a reader
learning to compose a UI; numbering the sections that organization already produces costs that
reader nothing and is what makes the corpus reachable by a question.

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
and license, rather than an argument re-derived in forge's terms. The colour-authoring reference is
the one file in that position, because its subject is values forge carries rather than judgements
forge re-argued.

**A file with no such source carries no footer, and that is the correct state rather than a gap.**
A `## Sources` section listing what a page did not draw on credits nobody, and a corpus where every
file carries one teaches a reader to skip the two that mean something. Adding a footer is warranted
by a source, never by symmetry.

---

## 8. Dial Defaults — Density, Variance, Motion

Forge ratifies three dials, each on a 1–10 scale, and sets its app-UI defaults:

| Dial | Default | What it sets |
| --- | --- | --- |
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
