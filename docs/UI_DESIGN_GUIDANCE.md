---
title: UI Design Guidance
description: "Why the src/ui/design corpus exists, its two-tier rule model, the stable rule-id scheme, its anti-drift gate contract, and the doc boundary it holds."
audience: consumer
---

# UI Design Guidance

> Owns the scheme the consumer-facing design corpus at `src/ui/design/` is written against: the two tiers a rule may occupy, the identifier every
> rule carries, the admission test a candidate rule must pass, the anti-drift contract with the design gate, and forge's ratified dial
> defaults.
>
> It governs the corpus's _shape_, never its content. No design rule is stated here.
>
> Defers to: [`UI_SSR_COMPONENTS.md`][usc] for the `ui/core` component contract; [`UI_CLASS_COMPOSITION.md`][ucc] for the class utilities and the
> conflict table; [`UI_CLIENT_RUNTIME.md`][ucr] for the browser tier and the SSR boundary; [`AGENT_GUIDE.md`][ag] for the governing-doc format this
> document is itself subject to; `src/ui/README.md` for every component's props, signature, and worked usage.

---

## 0. Quick Reference

- §1 Corpus Purpose and Composition Gap: what a correct-but-low-craft UI looks like, and why the API reference cannot close it
- §1a Termination in a Forge Primitive: the property that makes most rules grep-checkable
- §2 Rule Tiers — Floor and Defaults: the only two strengths a corpus rule may have
- §2a Floor — Verify and Refuse: bare imperatives, split into the two halves
- §2b Defaults — Rebuttable Aesthetic Guidance: the `Default:` opener, the mandatory `unless …` condition, and a tell's prose order
- §2c Override Authority — the Written Brief: who may rebut a Default, and who may not
- §3 Rule Identifier Scheme: the corpus's stable citation anchor
- §3a Marker Syntax and Placement: the HTML comment opening its block, with the register's statement rendered there
- §3b Identifier Stability and Citation: ids are never renamed, never renumbered, never reused; the retired list
- §3c The Forge-Primitive Admission Test: what a candidate rule must name to be admitted
- §4 Anti-Drift Contract with the Design Gate: the corpus may not describe an API forge lacks
- §4a Gate Enforcement Across Both Tiers: the gate's second direction, and why a gated rule is not thereby a Floor rule
- §4b Enforcement Mechanisms: the check steps, the oxlint plugin and the browser set, and the register naming which one catches each rule
- §4c Code Fences Compile Against the Exports: every tsx fence is a module; forge names imported, app context free
- §5 Three-Way Documentation Boundary: which of three homes owns a given statement
- §5a Routing Rule for a New Design Rule: design rules and anti-patterns never land in `docs/`
- §6 The Corpus Is Subject to the Governing-Doc Format: numbering and a Quick Reference, because warden reads both
- §7 Sourcing Constraint and Attribution: facts are usable, prose is not, credit is owed
- §7a Attribution Placement — Corpus Footer and File Footers: where a `## Sources` section belongs, and where one would be noise
- §8 Dial Defaults — Density, Variance, Motion: forge's ratified app-UI setting on three scales

---

## 1. Corpus Purpose and Composition Gap

Forge's `ui` namespace is documented for _calling_, not for _composing_. The corpus at `src/ui/design/` closes that gap: an agent handed only the
API reference can wire every component correctly and still ship output that type-checks, passes its tests, and reads as a defect. The corpus names
those patterns; `src/ui/design/floor.md` and `src/ui/design/tells.md` own the catalogue, and this document carries no second copy of it (§5a).

Its job is **not** to restate design literature, which an agent cannot act on and a gate cannot check.

### 1a. Termination in a Forge Primitive

The corpus's method is a single move applied everywhere: **every abstract principle terminates in a named forge primitive** — a component, a
semantic token, a class utility, or a state attribute.

"Establish a clear visual hierarchy" terminates in nothing and is therefore unactionable. "Body copy uses the muted foreground token; the surface's
default foreground token is reserved for the primary line" terminates in two named tokens, and a reviewer can grep for the literal that violates it.

This is what makes most corpus rules mechanically checkable rather than merely persuasive, and it is the property the admission test in §3c
enforces.

---

## 2. Rule Tiers — Floor and Defaults

A corpus rule occupies exactly one of two tiers; a rule that fits neither is not yet a rule.

### 2a. Floor — Verify and Refuse

**Tier 1, the Floor, is invariant: no brief, from anyone, overrides a Floor rule.** Each is checkable by a reviewer against a named forge primitive
(§1a), not necessarily by a command, and its statement, which the register holds (§3a), is a bare imperative — no hedging, no "prefer", no
"consider".

The Floor is split into two halves, and the split is structural rather than cosmetic:

- **Verify** — an obligation. Something that must be present, satisfied, or measured before the work is done.
- **Refuse** — a prohibition. Something that must never appear in output, regardless of what was asked for.

The two halves are read at different moments. Verify is a pre-completion pass; Refuse is a constraint held during generation. Interleaving them
produces a list that serves neither.

### 2b. Defaults — Rebuttable Aesthetic Guidance

**Tier 2, the Defaults, are rebuttable.** They carry forge's aesthetic position, including the catalogue of AI tells — the recurring output patterns
that mark work as machine-composed rather than designed.

<!-- rule:forge-design-default-form --> Every Default rule's statement, which the register holds (§3a), obeys two formal requirements:

1. It opens with the literal token `Default:`. The token is what distinguishes a rebuttable position from a Floor imperative when the two sit on
   adjacent lines, and it is what a reader scanning for "what may I change" matches on.
2. It ends with its **override condition** — the circumstance under which departing is correct, as an `unless …` clause.
   A Default with no stated override condition is either a Floor rule that was misfiled, or a preference with no argument behind it. Both are
   defects.

The prose after the marker argues the default and restates neither the opener nor the override condition.

A tell in `src/ui/design/tells.md` names in its statement the pattern it avoids. Its prose runs in a fixed order: the pattern, the reason it reads
as generated, then whatever of the remedy the statement does not carry.

### 2c. Override Authority — the Written Brief

A Default is overridable **only by an explicit written brief from the consumer**.

Never the agent's own preference, a judgement that the default looks plain here, or inference from the surrounding code: rebutting a Default without
a brief deletes the guidance. A brief that contradicts a Floor rule (§2a) is refused.

---

## 3. Rule Identifier Scheme

Every rule in the corpus carries a stable identifier. The scheme is the corpus's load-bearing mechanism: it is what lets a checklist item, a
detector finding, and a review report all point at the same rule, exactly as `§N` numbers are cited across `docs/`.

### 3a. Marker Syntax and Placement

The identifier is written as an HTML comment that opens the paragraph, list item or table cell arguing the rule, followed by the rationale:

    <!-- rule:forge-ui-color-token-only --> No `#hex`, no `rgb()` …

<!-- rule:forge-design-marker-prefix --> Form: kebab-case.

The rule's sentence is not in the file. It is the statement `config/rules.config.ts` declares for the id, and warden renders it in bold ahead of the
marker when it serves the section, so a reader through warden gets the rule and then its argument ([`SOURCE_OF_TRUTH.md`][sot-5a] §5a).
`validate-rules` fails a marker with prose before it in its block, which is a sentence the register already holds.

An HTML comment carries it because it is invisible when rendered, while `rg 'rule:forge-ui-'` enumerates the whole normative surface in one pass.

One marker per rule, and each opens a block of its own: two rules argued together are two paragraphs, because a finding that cites a paragraph
tells a reader which paragraph, not which rule.

### 3b. Identifier Stability and Citation

**Identifiers are never renamed, never renumbered, and never reused**, because an id is cited from outside the corpus — by checklists, detector
output and review reports — the moment it ships. The consequences are the ones [`AGENT_GUIDE.md`][ag-2c] §2c draws for section numbers: the sentence
may be reworded freely, a deleted rule's id stays retired, and a rule that splits keeps its id on the half that inherits its meaning. Ids carry no
sequence and no hierarchy; grouping is the headings' job.

**The corpus's section numbers carry the same obligation** that [`AGENT_GUIDE.md`][ag-2c] §2c places on every governing document's, because a
section number is the address `knowledge_read` resolves.

**Retired ids.** `forge-ui-viewport-units` is retired. `h-screen` and `w-screen` are two class names, which is a restriction list rather than a rule
that admits judgement, and the guidance prose in `floor.md` states it as well without one. The id stays retired rather than reassigned: a citation
that outlived it lands on nothing rather than on a different sentence.

### 3c. The Forge-Primitive Admission Test

**A rule that cannot name a forge component, token, utility, or class does not belong in the corpus**; the test is applied before an id is minted,
and it is what stops the corpus drifting into an unchecked design textbook. Material that fails it is a general principle forge has no standing to
restate (§7), so it goes to the corpus's `## Sources` footer, credited to whoever argued it first.

---

## 4. Anti-Drift Contract with the Design Gate

The corpus makes claims about forge's API on nearly every line — it names components, token names, variant names, and utility signatures. Those
claims drift the moment the API moves, and a corpus that teaches a component forge does not have is worse than one that teaches nothing, because it
is followed.

<!-- rule:forge-design-api-exists --> Enforcement is a gate step. `warden/src/checks/design.ts` owns the policy — what is asserted, what fails, in
what order, with what message — and `src/tooling/gate/checks/design-parse.ts` owns the matchers it decides on: how a claim is extracted from prose,
and how it is resolved against forge's real exports. The split is the one described for the barrel and namespace-graph checks in
[`AGENT_GUIDE.md`][ag-8] §8.

**Neither the assertion list nor its failure modes are restated here.** Restating a check list in prose produces a second copy that is
indistinguishable from an amendment the first time the two disagree. A reader asking "what exactly is checked" reads the script; this section owns
only the contract the script exists to uphold, and the fact that the corpus is subject to it.

### 4a. Gate Enforcement Across Both Tiers

These properties of that gate step are not derivable from the contract sentence above, and a reader who assumes either one wrongly draws a
conclusion about rule strength that is not there.

**Enforcement runs in both directions.** The corpus is checked against forge's API by `validate-design`, and forge's own source is checked against
the corpus by the `lint` step — **all of it that renders markup, not `src/ui/` alone**. The second direction is why a rule the corpus publishes for
consumers can fail forge's own build: forge is held to the guidance it ships, and its worked examples most tightly of all, because an example that
contradicts the rule beside it teaches the contradiction rather than the rule.

The scope is the whole source tree because the corpus states rules about _markup_, and forge renders markup outside `ui/` — `logging/viewer/` is an
entire surface. Narrowed to `ui/`, the second direction would be a claim wider than the check behind it. Where a rule
is genuinely local to one directory, an `overrides` entry in `.oxlintrc.json` scopes it, because that scoping is part of what the rule means rather
than a property of where a walk happens to start.

**An enforced rule is not thereby a Floor rule.** Which rules are checked statically is decided by mechanical checkability (§1a) alone, so the
enforced set spans both tiers, and a Tier-2 Default that the AST reveals is checked exactly as a Floor rule is. That does not promote it. An
enforced Default remains rebuttable in the sense §2b defines, through a per-site `oxlint-disable-next-line forge/<key> -- <why>`.

<!-- rule:forge-suppression-needs-reason --> The written reason is the form §2c's written brief takes inside forge's own source — stated, attached
to the line it excuses, and reviewable, rather than inferred or silent. `forge/suppression-needs-reason` is what makes it mandatory rather than
customary.

The suppression mechanism itself is uniform across rule ids; the tiers are not encoded in it, and could not usefully be. What §2a and §2c decide is
who may write one and on what grounds — a stated reason for a Default, and nothing at all for a Floor rule, where a suppression is a defect to
remove rather than an override to accept.

### 4b. Enforcement Mechanisms

Which mechanism enforces a corpus rule is a property of **what the rule has to read** rather than of its tier, or of whether its subject is markup
or a class string. A rule whose parts read different things has one mechanism per part, and the register lists each.

**forge's oxlint plugin** — `@y-core/forge/tooling/lint`, run by the `lint` step — owns every rule a **parsed file settles**. That is both families:
a class string, and markup structure. A tag name, an attribute, an ancestor chain and the body between two tags are all things `JSXOpeningElement`
and a parent walk give directly, so a hand-written scanner buys nothing the parser is not already offering. The parser is also
what makes a rule precise: a CSS property name in a generated table, a sentence containing the word `prose`, and a class name quoted in an assertion
are not class strings, because the parser says they are not. A plugin rule's per-site suppression is
`oxlint-disable-next-line forge/<key> -- <why>`, and because the rule is a lint rule it is also eligible for a fixer — a `CheckStep` can never carry
one.

**`validate-contrast`** owns a rule no source text states: `forge-ui-contrast-floor` is measured off resolved colours, so it reads no `.tsx` at
all.

**`validate-faded-text`** owns the part of that rule a class does state: a fade below full strength — an `opacity-*` or a text colour's `/alpha`
modifier in a class string, or either one in a stylesheet's `@apply` — which the contrast audit measures at 100%. A fade that paints only the
disabled state is exempt. What holds such a site is [`THEME_GENERATION.md`][tg-3a] §3a's.

<!-- rule:forge-lint-no-theme-import --> That is why it is a gate step rather than a plugin rule: a site is held by the audited pair register under
`ui/contracts/theme`.

**The browser set** owns `forge-ui-hit-target`: a target's box exists only once an engine lays it out, so `src/ui/hit-target.browser.ts` measures
every component the `core` and `chrome` barrels publish, in every engine.

**What a plugin rule cannot own** is a rule needing more than one file — an import graph, an export map, a compiled stylesheet, a README held
against a barrel. oxlint judges one file at a time, which is why those checks stay gate steps and why `validate-design` still runs: it holds the
corpus's citations — subpaths, exported names, custom properties and rule ids — and its `tsx` fences against forge's API (§4c), none of which is a
per-file question.

**The rule register names each rule's detectors.** A rule's entry in `config/rules.config.ts` lists every mechanism above that catches it, and a
plugin rule carries the id it reports under. `validate-rules` holds the two against each other, so a detector deleted on either side fails the gate
by id ([`SOURCE_OF_TRUTH.md`][sot-5b] §5b).

**Which rules are enforced, by which mechanism, and what each matches is not restated here**, for the reason §4 gives: the register and the plugin
own it.

Some plugin rules resolve a class against the design system itself — which utility roots take a spacing value, which take a colour, and what
steps the scale offers. Those facts are generated from the compiled stylesheet into `src/tooling/lint/data/design-scale.ts` and held there by
`validate-design-scale`, on the same drift contract `validate-class-groups` holds `cn`'s table to.

**The two derivations are parallel and are deliberately not folded into one.** Both read the same compiled design system, which is the source of
truth they actually share; but the other one's output is `cn`'s conflict model ([`UI_CLASS_COMPOSITION.md`][ucc-1c] §1c), and coupling the linter's
data to it would make each a hostage of the other's changes.

**`spacing-scale-only` reports an arbitrary value only where a scale step states that exact length.** `p-[8px]` is reported because `p-2` is the
same eight pixels; `p-[7px]` is not, because no step is seven. The promise worth making is a suggestion the author can act on. A rule that also
flagged the off-scale value would be a different rule, arguing that off-scale lengths are wrong in themselves — a case the corpus does not make and
this one does not pretend to.

**A class list bound to a module-scope `const` is judged where the name is used**, because forge writes most of its recipes that way and a plugin
reading only inline literals would be blind to them. Which bindings are followed, and the `*_CLASS` / `*_CLASSES` constants judged where they are
declared, are `src/tooling/lint/ast.ts`'s.

### 4c. Code Fences Compile Against the Exports

**Every `tsx` fence in the corpus and in `src/ui/README.md` is consumer code**, and `validate-design` compiles each one as a module of its own under
the consumer fixture's compiler options and its ambient declarations. A fence that does not compile describes an API forge lacks, which is the
breach §4 forbids, written in code rather than in prose.

- **A name forge exports is imported in the fence that uses it.** A missing import is a finding that names the subpath exporting it.
- **Any other name a fence uses without defining is app context** — `errors`, `rows`, `hrefFor`, an `AppIcon` bound elsewhere. The check declares
  it `any`; the fence never declares it.
- **A top-level JSX expression ends in `;`**, or the next one parses as its continuation.
- <!-- rule:forge-design-wrong-example-compiles --> Markup that is not TSX is tagged `html`, `ts` or `text`, and is not compiled.
- **A diagnostic outside a fence fails the check.** It means the run compiled something other than the fences: a missing ambient declaration, or a
  forge source that breaks under consumer options.

**There is no opt-out marker and no hidden prelude.** A marker is a second way to write a fence, and it exempts exactly the fence that goes stale.
A prelude is an invisible second copy of the context the fence already shows. App context needs neither, because a name the compiler cannot find
and forge does not export can only be the app's own.

---

## 5. Three-Way Documentation Boundary

Each home for a statement about forge's UI answers a different question:

| Home | Owns | The question it answers |
| --- | --- | --- |
| `docs/` | forge-**internal** constraints | What must forge's own source do? |
| `src/ui/README.md` | **API usage** | How do I call this, with what arguments? |
| `src/ui/design/` | consumer-facing **design judgement** | Which one should I call, and what does good look like? |

The distinction between the second and third is the one that is actually hard, so state it concretely: that a component accepts a given variant is
API usage. That one of those variants is the right choice for a destructive confirmation, and that reaching for a different one signals severity the
interaction does not carry, is design judgement.

The first row is unchanged from [`AGENT_GUIDE.md`][ag-6c] §6c — it is restated here only because the three-way split is unreadable with one row
missing.

### 5a. Routing Rule for a New Design Rule

<!-- rule:forge-design-rule-in-corpus --> The rule is stated as an absolute because the failure it prevents is silent. A design rule written into a
governing document is read by forge's own contributors and never by the consumers it was written for, while the corpus that should carry it develops
a gap nobody notices.

The reverse holds too: a constraint on forge's own source — what a component must render or never accept — is a governing-document rule, however
design-shaped it sounds.

---

## 6. The Corpus Is Subject to the Governing-Doc Format

`config/steps.config.ts` gives the docs check the corpus at `src/ui/design/` as an `extraDirs` entry marked `numbered`, which is what puts a tree
outside `docs/` under the whole format rather than the per-line prose rules alone.

**The corpus is fully subject to that format** — `## N.` numbered headings, a `## 0. Quick Reference` naming every one of them, the frontmatter
fields, and the size thresholds — exactly as this document is.

The reason is retrieval, not house style. Warden indexes the corpus, and the Quick Reference line is where a section's **gloss** comes from: the
one-line summary a search result prints under the heading trail, and a ranked column in its own right, weighted far above the section's body text. A
corpus with no Quick Reference forfeits that column and prints a bare heading to every reader who searches it.

The size thresholds bind for the same reason: `knowledge_read` returns a section whole, and a section that cannot be summarised in one Quick
Reference line carries more than one idea and wants `###` children.

A numbered section and a rule id (§3) address different things and neither replaces the other: **a rule id names a sentence; a section number names
a chunk.** A finding cites the sentence it rests on. Only the section number is addressable by `knowledge_read`.

None of this is a constraint on how the corpus reads. Its files are still organized for a reader learning to compose a UI; numbering the sections
that organization already produces costs that reader nothing and is what makes the corpus reachable by a question.

---

## 7. Sourcing Constraint and Attribution

The corpus is **written fresh**. It is not assembled from, and does not paraphrase closely, any existing design text.

The line runs between facts and expression:

- **Facts are usable.** Principles and numeric constants are not ownable, so the corpus states them plainly wherever one anchors a rule. The values
  themselves are the corpus's — `src/ui/design/floor.md` carries each one beside the rule it anchors, and repeating them here would put a second
  copy under a document the design gate does not walk (§5a).
- **Source prose is not.** No sentence, phrasing, table, or ordered structure is carried over from a source. Where a source's argument is used, it
  is re-derived against forge's primitives (§1a), which is a rewrite in the only sense that matters.

**Attribution is owed** in the corpus's `## Sources` footer — every text whose reasoning shaped a rule, credited by name. The footer is also where
material that fails the admission test lands (§3c).

This constraint exists because forge is a published npm package. The corpus ships inside it, to every consumer, under forge's license. Guidance that
would be merely awkward in an internal document is a licensing defect when it is distributed.

### 7a. Attribution Placement — Corpus Footer and File Footers

**Attribution is owed per corpus, not per file.** The corpus's entry point carries the `## Sources` footer that credits the texts whose reasoning
shaped its rules, and that footer covers every file, because the re-derivation those rules went through (§7) is corpus-wide rather than local to a
page.

**A file carries its own footer only when it rests on a source of its own that the corpus-level credit does not cover** — a named third-party
palette a forge stylesheet resamples, with its version and license, rather than an argument re-derived in forge's terms. The colour-authoring
reference is in that position, because its subject is values forge carries rather than judgements forge re-argued.

**A file with no such source carries no footer**, because a `## Sources` section on every file teaches a reader to skip the two that mean something.

---

## 8. Dial Defaults — Density, Variance, Motion

Forge ratifies three dials, each on a 1–10 scale, and sets its app-UI defaults:

| Dial | Default | What it sets |
| --- | --- | --- |
| Density | 5 | How much information occupies a given area, and how tight the spacing scale runs |
| Variance | 4 | How much a surface departs from the plainest arrangement that works |
| Motion | 3 | How much movement the interface carries, via the `@y-core/forge/ui/client` transition states |

These are deliberately restrained relative to the design sources the corpus credits, and the reason is a difference in target rather than a
disagreement about taste. Most published design guidance is shaped by marketing surfaces — a page seen once, where variance earns attention and
motion rewards a scroll. **Forge's primary target is product and app UI**: surfaces seen many times a day, by a user who came to complete a task.
There, variance costs recognition and motion costs time.

Marketing surfaces are a secondary target, and they are the standing case for a written brief (§2c) raising each dial.

The dials are Defaults, not Floor — each is rebuttable per §2b, and each rebuttal is a brief, not a preference.

[ag]: ../warden/canon/shared/AGENT_GUIDE.md
[ag-2c]: ../warden/canon/shared/AGENT_GUIDE.md#2c-renumbering-is-atomic
[ag-6c]: ../warden/canon/shared/AGENT_GUIDE.md#6c-decisions-versus-usage--the-readme-boundary
[ag-8]: ../warden/canon/shared/AGENT_GUIDE.md#8-single-home-rule-and-the-source-of-truth-register
[sot-5a]: ./SOURCE_OF_TRUTH.md#5a-what-an-entry-holds-and-what-it-derives
[sot-5b]: ./SOURCE_OF_TRUTH.md#5b-the-round-trip-is-checked
[tg-3a]: ./THEME_GENERATION.md#3a-audited-pairs-and-criteria
[ucc]: ./UI_CLASS_COMPOSITION.md
[ucc-1c]: ./UI_CLASS_COMPOSITION.md#1c-the-table-is-derived-from-the-compiled-design-system
[ucr]: ./UI_CLIENT_RUNTIME.md
[usc]: ./UI_SSR_COMPONENTS.md
