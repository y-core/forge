# Reviewing a UI

This file is used to *audit* a surface rather than to build one. It is the pass you run against
someone else's markup — or your own, an hour later — and its output is a list of findings, each one
attributable to a rule that already exists in this corpus.

The review has three parts, run in order: a heuristic pass over named dimensions, a persona pass,
and a report. The order matters, because the persona pass finds things the dimension pass cannot
see, and the report shape is what makes both of them arguable.

## Part 1 — the heuristic pass

Walk the dimensions below in order. Each one is scored against the `reference/` file that owns it;
a finding is only a finding if it can name the rule id it violates.

| Dimension | What you are looking for | Owned by |
|---|---|---|
| Hierarchy | Count of `primary` buttons per surface; whether `Alert` / `Toast` / `Badge` variants match the severity they claim | `01-hierarchy.md` |
| Layout | Whether groups are separated by the spacing scale or by borders; whether `Card` nesting appears | `02-layout.md`, plus `forge-ui-no-nested-card` |
| Typography | Type steps that differ by too little to read as different; measure on every block of body copy | `03-typography.md`, plus `forge-ui-measure-cap` |
| Color | Token use only; count of text colors on the surface; every background paired with its `*-foreground` | `04-color.md`, plus `forge-ui-color-token-only`, `forge-ui-text-color-budget`, `forge-ui-foreground-pairing` |
| Depth | Whether each elevation encodes something; whether one radius holds | `05-depth.md`, plus `forge-ui-one-radius` |
| Forms | `FormField` wiring, label presence, error placement, `Honeypot` on mutation forms | `06-forms.md`, plus `forge-ui-accessible-name` |
| States | Does an empty state exist; an error state; a loading state whose shape matches what is awaited | `07-states.md`, plus `forge-ui-empty-state` |
| Navigation | Whether the current location is expressed by more than color; whether `Tabs` and `Navbar` state survives a reload | `08-navigation.md`, plus `forge-ui-not-color-alone` |
| Interaction | Whether every state change is caused by the user; motion budget against the dial | `09-interaction.md` and `12-density.md`, plus `forge-ui-reduced-motion` |
| Accessibility | Heading order, focus ring, hit target, contrast, accessible names | `10-accessibility.md` and `floor.md` — every item here is Floor |
| Density fit | Whether the dial setting matches the surface's signal | `12-density.md` |

Default: a review walks all eleven dimensions in the order above before reporting any of them,
because a hierarchy finding often explains a color finding and reporting the color one first sends
the fix to the wrong place — unless the review is explicitly scoped to one dimension by the
request. <!-- rule:forge-ui-review-dimension-pass -->

Default: contrast, token pairing, and any dark-mode-sensitive finding is checked in both `:root`
and `.dark`, and the finding names which theme it was observed in, unless the surface ships in one
theme only. <!-- rule:forge-ui-review-both-themes -->

## Part 2 — severity

Two reviewers should assign the same severity to the same finding. That is the only test this scale
has to pass, so the boundaries are drawn where they are checkable rather than where they feel right.

| Severity | Definition | Examples |
|---|---|---|
| **P0** | A Floor violation, **or** a surface that cannot be used | Any rule in `floor.md`; a control unreachable by keyboard; an invisible focus ring; text under 4.5:1; a hit target below the `sm` box; a fabricated metric |
| **P1** | A state that does not exist, or a hierarchy inversion | No empty state on a collection that starts empty; no error rendering on a form that can fail; three `primary` buttons; a `destructive` `Alert` on a routine confirmation |
| **P2** | A Default violation with a real, nameable cost | An arbitrary spacing value; a `Card` per row in a dense list; a `Badge default` on every row; an FAQ built from stacked cards |
| **P3** | A taste note, correct but costless | A `gap-3` that would read better at `gap-4`; a heading that could be one step larger |

Default: severity is assigned by the definition above and not by how visible the problem is —
a failing contrast pair in a footer is P0 and a slightly tight hero gap is P3, however the two
look on screen. <!-- rule:forge-ui-review-severity-scale -->

**A Floor violation is always P0, and it is never negotiated down.** Not because the surface looks
fine, not because the brief asked for it, not because the violation is small or in an unimportant
corner. The Floor admits no override at all — that is what makes it the Floor rather than a strong
default — so a review that downgrades one has changed the rule rather than applied it.

Default: any finding citing a rule id from `floor.md` is reported at P0, and a brief that requested
the violating behaviour is itself reported as a finding — unless the cited id turns out not to be a
Floor rule, which is a misattribution to correct rather than a severity to negotiate. <!-- rule:forge-ui-review-floor-is-p0 -->

Default: a P3 finding is reported at most three times per review, because a report where taste
notes outnumber defects gets read as a taste document and the P0s go unfixed — unless the review
was explicitly requested as a polish pass. <!-- rule:forge-ui-review-p3-budget -->

## Part 3 — personas

The dimension pass reads markup. The persona pass reads *use*, and each persona catches a class of
defect that no other one will surface.

| Review as | Do this | What it alone catches |
|---|---|---|
| Keyboard-only | Tab from the top of the document to the bottom, then back | An unreachable control; a focus order that does not match the visual one; a `Dialog` that does not trap or restore focus; a `Menu` whose items are inert because `@y-core/forge/ui/core/client` was never imported |
| Screen-reader | Read the accessible name of every control and the heading outline | An icon-only `Button` with no `aria-label`; a skipped heading level; a `FormField` whose `aria-describedby` points at nothing; status carried by color alone |
| First-time | Look at the surface knowing nothing about the product | A label that assumes internal vocabulary; a primary action that is not obvious; an empty state that explains nothing |
| Returning power user | Do the frequent task ten times in a row | Motion that was charming once and is now a delay; a confirmation `Dialog` on a reversible action; a density too loose for the frequency |
| Small viewport | Render at the narrowest supported width | A `ScrollArea` that swallows the page scroll; a table with no horizontal strategy; `h-screen` where `min-h-dvh` belongs; a toolbar whose targets collapse below `sm` |
| Slow network | Render with the client bundle absent and with data pending | Whether the SSR markup is usable before hydration; whether a `Skeleton` matches the shape being awaited or a `Spinner` was used where the shape is known |

Default: a full review runs all six personas, and each persona's findings are attributed to that
persona in the report so a partial re-review can repeat exactly one of them, unless the review is
scoped to a specific persona by the request. <!-- rule:forge-ui-review-persona-pass -->

Default: the keyboard-only and screen-reader passes are run on every review regardless of scope,
because both surface P0s and neither is inferable from reading markup alone, unless the surface
renders no interactive element at all. <!-- rule:forge-ui-review-a11y-personas-always -->

## Part 4 — the report

One finding per line. Five fields, in this order, with no prose paragraph around them:

```
P0  forge-ui-focus-ring        src/routes/settings.tsx:84   Close button sets `outline-none` with no replacement ring — focus is invisible when tabbing.   Add `focus-visible:ring-2 focus-visible:ring-ring`.
P1  forge-ui-empty-state       src/routes/jobs.tsx:31       Job list renders nothing when the collection is empty on first load.   Add a `Card.Content` line plus a `secondary` Button that starts a job.
P2  forge-ui-density-gap-scale src/routes/jobs.tsx:47        Row padding is `p-[7px]`.   Use `p-2`.
P3  <rule-id>                  src/routes/jobs.tsx:12        …   …
```

Default: every finding is one line carrying severity, rule id, `file:line`, the observation, and
the fix — never a paragraph, and never a finding that describes a problem without naming the change
that resolves it. <!-- rule:forge-ui-review-report-line -->

Default: findings are ordered by severity and then by file, so the P0s are readable without
scrolling, unless the report is grouped by persona for a persona-scoped review. <!-- rule:forge-ui-review-order-by-severity -->

Default: a review reports findings and does not rewrite the surface, unless the request asked for
the fixes to be applied, in which case the report is still produced first so each change is
attributable to a rule. <!-- rule:forge-ui-review-no-rewrite -->

### The rule that keeps the review honest

**A finding with no rule id is not a finding.** When you cannot name one, exactly two things are
true and you must pick between them:

1. **The corpus is missing a rule.** The problem is real, it terminates in a forge primitive, and
   nobody has written it down. Write the rule — as a Tier 2 Default in the `reference/` file that
   owns the dimension, opening with `Default:` and ending with its override condition, carrying a
   newly minted id — and then cite it.
2. **It is a preference.** It does not terminate in a forge component, token, utility, or class, so
   it fails the admission test and it is not something this corpus has standing to require. Drop
   it.

There is no third option, and this is what stops a review from becoming a list of things the
reviewer would have done differently.

Default: a finding that cannot cite a rule id is either promoted into a new corpus rule or dropped
before the report is written, and is never reported as an unattributed observation, unless the
request explicitly asked for open-ended impressions — which is a critique, not a review, and says
so in its own heading. <!-- rule:forge-ui-review-unattributed-finding -->

Default: a newly minted rule is added to the `reference/` file owning its dimension rather than
stated inline in the report, so the next review inherits it, unless the reviewer does not own the
corpus, in which case the proposed rule is reported as such with its intended file. <!-- rule:forge-ui-review-new-rule-lands-in-corpus -->
