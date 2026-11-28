---
title: Marketing Surfaces
description: "Forge's secondary target, and the whole file is conditional: where a marketing page may depart from the product-UI defaults."
---

# Marketing Surfaces

**This is forge's secondary target, and the whole file is conditional.** Forge's primitives, its dial defaults, and every other file in this corpus
are tuned for product and app UI — surfaces a user visits repeatedly to finish a task. A landing page is the opposite case: seen once, by someone
who has not decided anything yet, where variance earns attention rather than costing recognition.

So read this file as a **standing case for a written brief**, in the sense of `docs/UI_DESIGN_GUIDANCE.md` §2c, raising the dials of
`12-density.md` from their ratified app-UI defaults (`UI_DESIGN_GUIDANCE.md` §8) toward roughly density 3, variance 7, motion 5.

## 0. Quick Reference

- §1 What actually changes: type steps, vertical rhythm, the hero, the one accent moment
- §2 Building it from components forge actually has: which primitive serves which marketing section
- §2a Before / after — the hero: a card framing the thesis as one item, against a plain section
- §3 What does not change: every Floor rule, and the fabrication rule most of all
- §4 Motion at 5: one entrance per section, and nothing that moves without the reader

---

## 1. What actually changes

Whether these levers apply at all is Floor: `forge-ui-marketing-brief-required`, in `floor.md`.

<!-- rule:forge-ui-marketing-authenticated-stays-app --> The levers below, and only those. Everything else on the page is composed exactly as it
would be in the app.

| Lever | App default | Marketing | Terminates in |
| --- | --- | --- | --- |
| Type steps | `text-sm` body, `text-base` headings | `text-base` body, `text-4xl`+ for the hero line | Tailwind type scale |
| Vertical rhythm | `p-6`, `gap-6` between sections | `py-16` or more, `gap-12` between sections | Tailwind spacing scale |
| The hero | none — a page starts at its content | one, at the top, carrying the single message | `Card`-free plain section |
| The accent moment | none | exactly one element using `--primary` as a surface | `bg-primary text-primary-foreground` |

<!-- rule:forge-ui-marketing-hero-once -->

<!-- rule:forge-ui-marketing-type-step-jump -->

<!-- rule:forge-ui-marketing-vertical-rhythm -->

<!-- rule:forge-ui-marketing-one-accent -->

## 2. Building it from components forge actually has

Forge ships no marketing-specific components, and none are needed. A landing page is the existing primitives at a different rhythm.

| Section | Component | How it is used |
| --- | --- | --- |
| Feature group | `Card` | One `Card` per feature, `Card.Title` + `Card.Description`, no footer button per card |
| Status or category label | `Badge` | `appearance="outline"` for a category, `tone="primary"` for the one thing genuinely new |
| FAQ | `Accordion` | `Accordion.Item` / `.Trigger` / `.Content` — native `<details>`, so it works with no JavaScript |
| Announcement or notice bar | `Alert` | `neutral` for news, `info` for a neutral fact; `warning` and `destructive` are not marketing tones |
| Email or trial capture | `Dialog` | `Dialog.Trigger` opens it; the platform owns backdrop and Escape |
| A named person | `Avatar` | Only with a real person's real image or initials via `Avatar.Fallback` |
| Section separation | `Separator` | Between bands, in place of a border on each `Card` |

<!-- rule:forge-ui-marketing-card-feature-group -->

<!-- rule:forge-ui-marketing-accordion-faq -->

<!-- rule:forge-ui-marketing-alert-notice -->

<!-- rule:forge-ui-marketing-dialog-capture -->

### 2a. Before / after — the hero

```tsx
import { Badge, Button, Card } from "@y-core/forge/ui/core";

<Card class='p-6'>
  <Card.Header>
    <Badge tone='primary' appearance='solid'>
      New
    </Badge>
    <Card.Title>Ship faster</Card.Title>
    <Card.Description>Trusted by 12,000 teams. 312% faster deploys.</Card.Description>
  </Card.Header>
  <Card.Footer>
    <Button>Start free trial</Button>
    <Button>Book a demo</Button>
  </Card.Footer>
</Card>;
```

Costs the page everything a hero is for: a `Card` frames the message as one item among many rather than as the page's thesis, the type steps are the
app's, two primary buttons mean no primary action, and the two numbers are invented — which is a Floor violation, not a taste note.

```tsx
import { Button } from "@y-core/forge/ui/core";

<section class='flex flex-col items-center gap-6 px-6 py-24 text-center'>
  <h1 class='max-w-prose text-3xl font-semibold text-foreground md:text-5xl'>Ship faster</h1>
  <p class='max-w-prose text-lg text-muted-foreground'>Deploy on every merge, with a rollback that takes one click.</p>
  <div class='flex gap-3'>
    <Button size='lg'>Start free trial</Button>
    <Button tone='neutral' appearance='ghost' size='lg'>
      Read the docs
    </Button>
  </div>
</section>;
```

That is two text colors, one accent, the measure capped, and one claim — which happens to be true of the product being described.

## 3. What does not change

**Every Floor rule holds, unchanged, on a marketing page.** The dials of `12-density.md` are Tier 2 Defaults; the Floor has no tier above it and no
brief reaches it. Specifically:

- `forge-ui-color-token-only` — a brand hue is expressed by overriding `--primary` in the app's stylesheet, not by writing a hex literal into a
  hero's `class`.
- `forge-ui-contrast-floor` — large display type at low contrast is a standing marketing accessibility failure. 3:1 for large text, in both `:root`
  and `.dark`.
- `forge-ui-focus-ring` and `forge-ui-hit-target` — a hero button is still a button.
- `forge-ui-reduced-motion` — every scroll-triggered animation at motion 5 needs a `motion-reduce:` path.
- `forge-ui-heading-order` — the hero `<h1>` is the page's only one, and section headings descend from it without a skip.
- `forge-ui-one-radius` — a marketing page is not the place to introduce a second corner radius.

<!-- rule:forge-ui-marketing-no-invented-proof --> **`forge-ui-no-fabricated-data` applies with full force here.** No invented metric, no invented
testimonial, no invented company logo, no invented person. "Trusted by 12,000 teams", "312% faster", a quote attributed to a fictional VP of
Engineering, an `Avatar` holding a stock face — every one is a fabrication, and shipping it is worse on a marketing surface than anywhere else in
the product, because a marketing surface is a claim to a stranger.

<!-- rule:forge-ui-marketing-avatar-real-person -->

<!-- rule:forge-ui-marketing-omit-unfilled-section -->

## 4. Motion at 5

<!-- rule:forge-ui-marketing-motion-ceiling --> The raised motion dial buys entrance transitions on scroll and a longer duration on state changes.
It does not buy anything that moves without the user causing it.
