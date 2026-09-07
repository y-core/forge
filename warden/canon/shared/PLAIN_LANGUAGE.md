---
title: Plain Language
description: "Reader-centred prose for governing documents and for what an agent says to a person: relevant, findable, understandable, usable — plus length, narration, and scope."
---

# Plain Language

> Owns the **quality of prose** on two surfaces: the text inside `docs/` documents,
> `CLAUDE.md`, and `README.md`; and what an agent says to a human being. Both have one reader
> who arrived with a question, and both fail the same way when the answer is absent, buried,
> obscure, or unusable.
>
> Defers to: [`AGENT_GUIDE.md`](./AGENT_GUIDE.md) for document _form_ — frontmatter, numbering,
> size, cross-references, and the Quick Reference convention;
> `CODE_RULES.md` §5 for source comments, which this document does not govern
> and does not loosen;
> `CODE_REVIEW.md` §1b for the shape of a review finding.

---

## 0. Quick Reference

- §1 Surfaces This Document Governs: the two it owns, and the four it does not
- §2 Plain Language Is Not Simplified Wording: why short sentences prove nothing
- §3 Relevant — Readers Get What They Need: content chosen before it is written
- §3a Identify the Reader: who arrives at a governing document, and at a terminal
- §3b Identify the Reader's Purpose: whose question the text answers when the two differ
- §3c Identify the Reading Context: the terminal, the interrupt, the `rg` landing
- §3d Select Content, and Select It Ethically: what to leave out, and what may never be
- §4 Findable — Readers Can Locate It: structure as a retrieval mechanism
- §4a Order by the Reader's Logic: the author's sequence is usually the wrong one
- §4b Most Important First, Warnings Before Instructions: the ordering rules that are not taste
- §4c Headings That Say What Is Beneath Them: the navigational contract of a heading
- §4d Information Design in Plain Text: lists, tables, fences, and `file:line`
- §4e Separate Supplementary Material: not everything competes for equal attention
- §5 Understandable — Readers Can Follow It: expression, once the content is right
- §5a Familiar Words Without Losing Precision: when the technical term is the plain one
- §5b Sentences That Expose Actor and Condition: who does what, when, and in what order
- §5c Concise Without Becoming Cryptic: shortness is not the objective
- §5d One Idea Per Paragraph, With Transitions: expose the logic rather than implying it
- §5e Respectful Tone — Clear Is Not Childish: authoritative and plain are compatible
- §6 Usable — Readers Can Act On It: the principle that closes the loop
- §6a Evaluate While Drafting: read the draft as the reader named in §3
- §6b The Curse of Knowledge: why the author is the worst judge of their own clarity
- §6c Evidence Over Belief — the Repeated Question: the one measurement available here
- §7 The Four Principles Operate Together: the worked failure, one principle at a time
- §8 Response Length and Proportion: length tracks substance, not effort
- §9 Progress Narration During Work: one sentence up front, then findings only
- §10 Corrections to Earlier Statements: correct what changes a decision, and nothing else
- §11 Scope of the Delivered Work: the asked-for scope is the deliverable
- §12 Delegation Restraint: when a sub-agent earns its cost, and when it does not
- §13 What This Document Does Not Enforce: why no check measures plainness

---

## 1. Surfaces This Document Governs

Two surfaces, one rule set:

| Surface | Governed here? | Owner if not |
| --- | --- | --- |
| Prose inside the canon and `docs/` | **yes** | — |
| `CLAUDE.md` sections, `README.md`, per-directory READMEs | **yes** | — |
| What an agent says to a human user | **yes** | — |
| Generated CLI help and error text | **yes** | — |
| Source comments | no | `CODE_RULES.md` §5 |
| Document form — numbering, frontmatter, size, Quick Reference | no | [`AGENT_GUIDE.md`](./AGENT_GUIDE.md) |
| Agent-to-agent reports | no | each agent definition's `## Return Format` |
| The shape of a review finding | no | `CODE_REVIEW.md` §1b |

The boundary against `AGENT_GUIDE.md` is **form versus plainness**, and it is the one worth
stating twice. `AGENT_GUIDE.md` decides that a document carries a `## 0. Quick Reference` and
that its headings are numbered. This document decides that those headings say what is beneath
them. A document can satisfy every rule in `AGENT_GUIDE.md` and still be unreadable; that
document is a defect here and nowhere else.

The boundary against the comment budget runs the other way. This document **never** licenses a
source comment. Where a rule below would improve a comment, the improvement is to delete the
comment and route its content per `CODE_RULES.md` §5c.

---

## 2. Plain Language Is Not Simplified Wording

A document is not plain because its sentences are short, because it avoids long words, because
it scores well on a readability metric, or because somebody corrected its grammar. Each of those
can be true of a document that fails completely.

Plainness is judged from the reader's side, against four outcomes:

| Principle | The question it asks |
| --- | --- |
| **Relevant** | What belongs here? |
| **Findable** | Where should it be? |
| **Understandable** | How should it be expressed? |
| **Usable** | Can the reader actually succeed with it? |

**The four are interdependent, not sequential.** They are not four editing passes and not four
boxes. A well-written rule filed in the wrong document fails. A correctly filed rule expressed
only as a check name fails. A findable, understandable rule that omits what to do instead fails.
Working through them in order is a convenience; satisfying only three is not partial credit.

The consequence for everything below: **plainness is decided before the first sentence is
written**, when the reader, the purpose, and the content are chosen. Editing at the end can fix
§5. It cannot fix §3.

---

## 3. Relevant — Readers Get What They Need

### 3a. Identify the Reader

Name the reader before writing. Two readers recur here, and they are not the same person.

**A governing document is read by an agent or an engineer mid-task**, with the surrounding code
already in view and a specific question in hand. They know the domain. They do not need the
domain explained, and they will not read to the end. What they need is the ruling, the reason it
holds, and the boundary where it stops.

**Feedback is read by the person who asked**, who holds the context of their own request and
nothing else. They do not have your tool output, your file listing, or your reasoning. They know
what they asked for and what they intend to do with the answer.

Reader characteristics that change the text: existing subject knowledge, how much of the
surrounding state they can see, and what they will do next. Writing for a generic "user" is how
a document ends up serving no one.

### 3b. Identify the Reader's Purpose

The author's purpose and the reader's purpose differ more often than not, and **the reader's
wins**.

An agent's purpose may be "report the refactor I completed". The reader's purpose is usually
"did it work, and what do I have to do now?" A document's author may intend to "record the
rationale for the boundary". The reader's purpose is "may I import this here?"

Design the text around the second question. Rationale that the reader did not ask for is
supplementary (§4e), not the opening.

### 3c. Identify the Reading Context

Context changes what the text should look like.

- **The terminal.** Feedback is read once, in a scrolling pane, often while the reader is doing
  something else. There is no second page to turn to and no index.
- **Limited attention.** The reader is mid-task. Attention spent parsing your structure is
  attention taken from the work.
- **Arrival at one section.** A governing document is usually reached through search, landing in
  the middle. Every section must make sense to somebody who has read no
  other section of that document. That is why cross-references exist (`AGENT_GUIDE.md` §5) —
  a section that only makes sense in sequence is a section most of its readers will misread.
- **Consequence of misunderstanding.** A destructive command, a security control, and a naming
  convention do not deserve the same care. Spend the words where being wrong costs the most.

### 3d. Select Content, and Select It Ethically

**Leave out what the reader does not need.** More explanation does not mean clearer
communication; irrelevant content is itself a plainness defect, because it dilutes what matters
and lengthens the path to it. The editing question is: _does the reader need this here, to do
what they came to do?_ If not, delete it, move it, or make it supplementary.

**And then the limit on that.** Selecting content ethically means three things, and the third is
the one under pressure:

1. Content is accurate.
2. Nothing false or misleading is included.
3. **Nothing the reader needs to know is hidden or left out.**

Brevity is never a licence for the third. In practice, in this corpus:

- **A failing test is said plainly**, with what failed. "Mostly green" is not a verdict.
- **A skipped step is named** as skipped, not omitted from the summary.
- **A part of the request not delivered is stated**, with the reason, rather than quietly
  dropped — the reader cannot re-scope what they do not know was cut (§11).
- **A caveat that would change the reader's next action is not compressed away.** Compressing
  it is the failure mode that brevity rules produce, and it is worse than the verbosity they fix.

---

## 4. Findable — Readers Can Locate It

Readers scan; they do not read from the top. Structure is therefore a retrieval mechanism, not
presentation.

### 4a. Order by the Reader's Logic

The author's order — how the work was done, how the system is built, how the team is organised —
is usually the wrong order for the reader. Two sequences can contain identical information and
only one match the reader's journey.

The author's order, in a report of completed work: _what I explored → what I found → what I
changed → whether it passed._ The reader's order: _did it work → what changed → what I need to
decide → what I could not do._

In a governing section: the ruling first, the reason second, the boundary and the exceptions
third. Not the history that produced the ruling.

### 4b. Most Important First, Warnings Before Instructions

Four ordering rules that are not matters of taste:

1. **The most important message goes where the reader looks first** — the top. In feedback, the
   outcome leads. In a section, the ruling leads.
2. **Build new information on what the reader already knows**, rather than defining forward.
3. **Procedures run chronologically.** A step list is the one place the reader's order and the
   author's order coincide.
4. **Warnings come before the instruction they qualify.** If getting a step wrong causes damage,
   the caveat precedes the command — never after it, never in a trailing note. A reader who acts
   on line one has already acted before reaching line four.

Rule 4 has a concrete form in feedback: **the risk of a destructive action is stated before the
command that performs it**, not appended once the reader has copied it.

### 4c. Headings That Say What Is Beneath Them

A heading is a promise about its contents, and a reader who scans only the headings should
arrive at an accurate mental model of the document.

| Weak | Better |
| --- | --- |
| `### 3a. General` | `### 3a. Fields a Request Must Carry` |
| `### 2b. Notes` | `### 2b. When a Guard May Be Skipped` |
| `### 5c. Details` | `### 5c. Ordering Within the Middleware List` |

This upgrades `AGENT_GUIDE.md`'s Quick Reference from a form requirement into a navigational
one. That block _is_ the document's index — there is no other. A `## 0.` whose lines are
accurate but uninformative satisfies the form check and still leaves the reader opening sections
at random to find the rule.

The same applies to a response: a heading, a bolded lead, or a first sentence is what the reader
scans. Make it carry the answer.

### 4d. Information Design in Plain Text

Visual structure reveals relationships that prose hides. Five conditions inside a 250-word
paragraph are harder to find than the same five as a list, and no amount of sentence-level
editing closes that gap.

The devices available here, and what each is for:

- **Lists** — for a set whose members are read independently, or a sequence acted on in order.
- **Tables** — for facts with more than one dimension: rule against owner, failure against route,
  weak against better.
- **Bold** — for the one clause in a paragraph that carries the ruling. Bold everywhere is bold
  nowhere.
- **Fenced blocks** — for anything the reader will copy: a command, a signature, an exact
  message.
- **`file.ts:88`** — for anything the reader will open. A path with a line number is a working
  reference; a prose description of where the code is, is not.
- **Whitespace and section breaks** — for separating what should not be read as one thought.

**Every device is functional.** A table with one column, a list of one item, or a heading that
introduces two sentences is decoration, and decoration costs the reader the moment they stop
believing structure means something.

### 4e. Separate Supplementary Material

Background, rationale, alternatives considered, and edge cases are often necessary without being
central to what the reader came for. Keep them available and keep them out of the way: later in
the section, in a linked document, or in a closing paragraph the reader can skip.

**Do not make every piece of information compete for equal attention.** A response in which the
outcome, an incidental observation, and a possible future improvement are three equal bullets has
made the reader do the ranking. Rank it for them.

---

## 5. Understandable — Readers Can Follow It

This is the principle most people mean by "plain language". It is third for a reason: expression
can only be fixed once §3 and §4 are right.

### 5a. Familiar Words Without Losing Precision

Where two expressions are equally accurate, prefer the one the reader is more likely to know:
_before_ over _prior to_, _if_ over _in the event that_, _enough_ over _a sufficient number of_.

**Simplification must not destroy precision.** A technical term is frequently the clearest term
available, and the reader identified in §3a already knows most of them. _Idempotent_, _isolate_,
_barrel_, _fail-closed_ — each names something no paraphrase names as exactly. Keep the term.
Where it is genuinely novel to the reader, keep it _and explain it once_; do not replace it with
an approximation that will need correcting later.

The goal is not simple words. The goal is **meaning that is immediately accessible to the
intended reader** — which, for this corpus's readers, sometimes means the more technical word.

### 5b. Sentences That Expose Actor and Condition

A sentence should make the actor, the sequence, and the condition visible.

Avoid:

> The request, subsequent to validation of its body by the boundary handler and subject to
> satisfaction of the applicable guard conditions, may be dispatched.

Prefer:

> The boundary handler validates the body first. If every guard passes, it dispatches the
> request.

The second names who acts, in what order, and under what condition.

**Active voice is the default, not a rule.** The passive is correct when the actor is unknown,
genuinely irrelevant, or deliberately secondary — _the connection was reset_ is better than
inventing an agent for it. Clarity decides; grammar does not.

### 5c. Concise Without Becoming Cryptic

Conciseness means removing unnecessary complexity, not reducing word count. **A 20-word sentence
that leaves the reader confused is worse than a 35-word one that explains.**

Delete: repetition, empty openers (_it is worth noting that_, _as mentioned above_), hedging
stacked on hedging, and restatements of what the previous paragraph established. Keep: the
condition, the exception, and the consequence. Those are what the reader came for, and they are
exactly what a word-count target removes first.

### 5d. One Idea Per Paragraph, With Transitions

Each paragraph carries one main idea, and the relationship between consecutive paragraphs is
stated rather than implied. _Because_, _however_, _therefore_, _before_, _after_, _if_ — these
are not filler; they are the load-bearing words that expose an argument's structure.

Readers should not have to reconstruct the reasoning themselves. When a paragraph's relationship
to the one above it is "and also", the two are one paragraph or one of them is unnecessary.

### 5e. Respectful Tone — Clear Is Not Childish

Plain language does not talk down. There is a real difference between clear and childish, and
professional text stays authoritative, precise, and sophisticated while being plain.

> You must add the barrel export before the gate will pass.

is clear and professional. There is no gain in:

> Kindly be advised that it is hereby required that the aforementioned export be added to the
> relevant barrel prior to the execution of the verification gate.

Nor in the opposite failure:

> Oops! Looks like we forgot something — no worries, easy fix!

The second adds formality and no substance. The third adds warmth and no substance, and costs
the reader a line of scanning to find out nothing happened. State it once, accurately, and move
on. Both failures are the same failure: words that are not information.

---

## 6. Usable — Readers Can Act On It

The fourth principle closes the loop. It is what makes this a communication standard rather than
a style guide: an author cannot establish that a document works by believing it does.

### 6a. Evaluate While Drafting

Before finishing, read the draft as the reader named in §3a, asking:

- Can they tell what this is about, from the first line?
- Can they find the part that matters, without reading it all?
- Is the required action explicit, including who performs it?
- Is every unfamiliar term either known to that reader or explained here?
- Is anything they need to know absent (§3d)?

**The house test, and the one to apply if you apply only one: could the reader act on this
without asking a follow-up question?**

### 6b. The Curse of Knowledge

Once you understand something, you cannot reliably predict what another reader will
misunderstand. This is not a failure of effort, and more care does not fix it — the author is
structurally the worst-placed judge of their own clarity.

Two practical consequences. First, prefer the concrete over the abstract when both are
available: a reader who does not share your model can still act on a named file, an exact
command, or a specific failing case. Second, treat "this is obvious" as a warning; it is a
statement about the author, not the text.

### 6c. Evidence Over Belief — the Repeated Question

Elaborate reader testing is not available here. One piece of evidence is, and it is enough:

**A repeated follow-up question is a defect in the message, not in the reader.**

When a reader has to ask "did it pass?", "which file?", "so what do I do now?", or "does that
mean it's broken?" — the answer to those questions belonged in the text and was not there. That
is a finding about the writing, and the correction goes into the writing.

The same evidence applies to documents. A rule that is repeatedly asked about, repeatedly
misapplied, or repeatedly re-derived from scratch is a rule whose document failed one of the four
principles. Find out which one before rewording it — rewording fixes only §5, and §5 is rarely
the one that broke.

---

## 7. The Four Principles Operate Together

One worked failure, in repo terms. A rule about where a new capability belongs:

- It is precisely written and easy to read, but it lives in the wrong document, so the engineer
  making that decision never reaches it — **not findable**. The prose is irreproachable and the
  rule may as well not exist.
- Moved to the right document, it is stated only as the name of the check that enforces it. The
  reader now finds it and learns nothing — **not understandable**.
- Rewritten to explain what is forbidden, it never says what to do instead. The reader knows they
  are blocked and not how to proceed — **not relevant**, because the content they needed was
  never selected.
- Given a destination at last, the destination reads "see the docs". Everything is present,
  visible, and comprehensible, and the reader still cannot finish — **not usable**.

That final failure is the one this corpus already refuses by name: a Growth Rules row whose
recipe says only "see the docs" is not a rule, and the instruction is to delete it or finish it.
That existing rule is §6 applied to one table. This document generalises it.

Plainness exists only when all four hold at once.

---

## 8. Response Length and Proportion

**Length tracks substance, not effort.** A response is as long as its content requires and no
longer; a long response is not evidence of thorough work, and padding a short answer hides the
answer inside it.

For feedback:

- **Most of the response is the main answer.** Caveats, alternatives, and observations are short
  and come after it.
- **Summarise at a high level unless depth was asked for.** A reader who wants the detail will
  ask; a reader who did not want it has to skip it.
- **Do not restate what the reader can see.** A diff they are looking at, a command they just
  ran, a file they named.
- **No closing recap of a short answer.** If the answer fits on a screen, summarising it doubles
  its length and adds nothing.

For written deliverables — documents, READMEs, plans: **match length to substance**. No filler
sections, no redundant summary of what the document just said, no boilerplate heading kept
because the template had one. `AGENT_GUIDE.md` §6a sets the size band; this rule is why a
document lands inside it naturally rather than being cut to fit.

---

## 9. Progress Narration During Work

Narration is for the reader's benefit, not a record of activity.

- **One sentence before the first tool call**, saying what you are about to do. Not a plan, not a
  list of the files you intend to read.
- **During the work, speak on a finding or a change of direction** — something discovered that
  the reader would want to know, or a decision to do something other than what was announced.
  Not on completing a step, not on starting the next one.
- **At the end, lead with the outcome.** What is now true, then what changed, then what is
  outstanding. The process that produced it is supplementary (§4e) and usually unnecessary.

A reader watching tool calls can already see that work is happening. Narrating it a second time
in prose is words that are not information (§5e).

---

## 10. Corrections to Earlier Statements

**Correct an earlier statement when the error would change the reader's code, conclusions, or
decisions. Otherwise, fix it silently and continue.**

When a correction is warranted, state it plainly and briefly, then carry on. No apology, no
preamble, no account of how the mistake arose, and no running tally of earlier mistakes. Combine
several corrections into one statement rather than enumerating each.

Two things that are not corrections, and must not be treated as one:

- **A follow-up question is not a signal of error.** A reader asking more about your work is
  asking about your work. Answer the question; do not re-audit the earlier statement.
- **An accurate statement needs no revisiting.** Do not restate how you verified something,
  re-hedge a claim you already qualified, or re-examine phrasing that was correct.

Where another agent's report contradicts your own finding, check it before adopting it. A
sub-agent's claim is a claim. When it turns out to be right, correct the substance and move on —
without narrating the correction itself.

---

## 11. Scope of the Delivered Work

**The requested scope is the deliverable.** Do not quietly narrow it, widen it, or convert it
into an adjacent task that seems more useful.

- **Make routine judgement calls; do not escalate them.** Where a choice has an obvious default
  and getting it wrong is cheap to reverse, choose, say what you chose, and continue. Ask only
  when two readings lead to materially different work.
- **State a concern in a sentence, then do the work.** If the request has a real problem, say so
  briefly, name the assumption you are proceeding under, and deliver. A concern is not a reason
  to stop, and a reaffirmed request is a decision.
- **Finish every part that is not blocked.** Do not stop at the easy portion and report
  completion.
- **Name what you left out, and why.** Silently reducing scope is a §3d failure — the reader
  cannot re-scope what they were not told was cut. Scaling the work down is their call.
- **Do not exceed the scope either.** An unrequested improvement, a nearby refactor, or an extra
  abstraction is expensive to review and was not asked for. Note it; do not build it.

---

## 12. Delegation Restraint

Delegation buys two things: **parallelism** across genuinely independent tracks, and **context
isolation**, keeping voluminous output out of the calling context. It buys nothing else, and it
is not free — every sub-agent costs setup, a prompt, and a synthesis step.

- **Delegate a track that is sizeable and independent.** Several unrelated areas surveyed at
  once; one mechanical change applied across many files; a gate whose output would otherwise fill
  this context.
- **Do not delegate what you can finish in a handful of tool calls.** Reading three files and
  answering is faster done than described to somebody else.
- **Do not delegate to verify or double-check your own work.** A second agent re-reading your
  change is not an independent check; it is the same reasoning at one remove, and it costs a full
  context to produce agreement. Where a mechanical check exists, run it — that is what a gate is
  for.
- **One agent where one suffices.** Two agents on one track produce two answers and a
  reconciliation problem.

Where an agent definition names a delegation boundary of its own — what it may never delegate,
where its gate runs go — that boundary is narrower than this section and wins.

---

## 13. What This Document Does Not Enforce

**No check measures plainness, and none is proposed.** The claim is recorded here rather than
implied, because a rule stronger than its control is the failure this corpus refuses.

**A readability score is insufficient, and would be optimised against.** It can find long
sentences and long words. It cannot determine whether the reader was given the information they
needed (§3), whether the structure matches the task they arrived with (§4), whether the technical
term retained was the right call (§5a), or whether the instructions let them finish (§6). A gate
built on one would reward exactly the simplified wording §2 rejects, and text would be shortened
to pass it — including the caveats §3d says may never be compressed away.

_Holds instead:_

1. **Review.** Prose quality is a review finding like any other, reported in the shape
   `CODE_REVIEW.md` §1b sets, naming the consequence rather than the
   section number.
2. **The repeated question (§6c).** A follow-up that a reader should not have had to ask is
   evidence, and it is the only measurement of this that exists. Acting on it is what makes §6
   more than an aspiration.
3. **The form checks that do exist.** `AGENT_GUIDE.md`'s numbering, Quick Reference, and
   cross-reference rules are enforced wherever a repository ships a documentation check. They
   prove a heading exists; §4c is what makes it worth reading. Form is checkable and plainness is
   not, which is precisely why the two are separate documents.
