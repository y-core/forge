# Marketing Surfaces

**This is forge's secondary target, and the whole file is conditional.** Forge's primitives, its
dial defaults, and every other file in this corpus are tuned for product and app UI — surfaces a
user visits repeatedly to finish a task. A landing page is the opposite case: seen once, by someone
who has not decided anything yet, where variance earns attention rather than costing recognition.

So read this file as a **standing case for a written brief**, in the sense of
`.decisions/implementation/UI_DESIGN_GUIDANCE.md` §2c, raising the three dials of `12-density.md` from their
ratified app-UI defaults (§8) toward roughly density 3, variance 7, motion 5.

Default: marketing dial settings apply only when a written brief identifies the surface as a
public-facing marketing or landing page, and never by inference from a route name, a file path, or
the surrounding copy. <!-- rule:forge-ui-marketing-brief-required -->

Default: a surface behind authentication is built at forge's app defaults even when its content is
promotional — an upgrade prompt, a feature announcement — unless the brief names it a marketing
surface explicitly. <!-- rule:forge-ui-marketing-authenticated-stays-app -->

## What actually changes

Four things, and only four. Everything else on the page is composed exactly as it would be in the
app.

| Lever | App default | Marketing | Terminates in |
|---|---|---|---|
| Type steps | `text-sm` body, `text-base` headings | `text-base` body, `text-4xl`+ for the hero line | Tailwind type scale |
| Vertical rhythm | `p-6`, `gap-6` between sections | `py-16` or more, `gap-12` between sections | Tailwind spacing scale |
| The hero | none — a page starts at its content | one, at the top, carrying the single message | `Card`-free plain section |
| The accent moment | none | exactly one element using `--primary` as a surface | `bg-primary text-primary-foreground` |

Default: a marketing page opens with exactly one hero region carrying one headline, one supporting
line, and one `primary` `Button`, unless the brief describes a page with two independent audiences
that must be split above the fold. <!-- rule:forge-ui-marketing-hero-once -->

Default: the hero headline is the only place a type step above `text-3xl` appears, and the jump
between the headline and the supporting line is at least two steps on the type scale, unless the
brief supplies its own typographic scale. <!-- rule:forge-ui-marketing-type-step-jump -->

Default: marketing sections separate at `py-16` or larger and their internal groups at `gap-8` or
larger, unless the section is a dense comparison table, which returns to the app density of
`12-density.md`. <!-- rule:forge-ui-marketing-vertical-rhythm -->

Default: exactly one element per page uses `--primary` as a filled surface — the hero's `primary`
`Button` is the usual holder — and every other call to action on the page is `secondary` or
`ghost`, unless the brief specifies a repeated end-of-section call to action. <!-- rule:forge-ui-marketing-one-accent -->

## Building it from components forge actually has

Forge ships no marketing-specific components, and none are needed. A landing page is the existing
primitives at a different rhythm.

| Section | Component | How it is used |
|---|---|---|
| Feature group | `Card` | One `Card` per feature, `Card.Title` + `Card.Description`, no footer button per card |
| Status or category label | `Badge` | `outline` for a category, `default` for the one thing genuinely new |
| FAQ | `Accordion` | `Accordion.Item` / `.Trigger` / `.Content` — native `<details>`, so it works with no JavaScript |
| Announcement or notice bar | `Alert` | `default` for news, `info` for a neutral fact; `warning` and `destructive` are not marketing tones |
| Email or trial capture | `Dialog` | `Dialog.Trigger` opens it; the platform owns backdrop and Escape |
| A named person | `Avatar` | Only with a real person's real image or initials via `Avatar.Fallback` |
| Section separation | `Separator` | Between bands, in place of a border on each `Card` |

Default: a marketing feature grid renders one `Card` per feature with `Card.Title` and
`Card.Description` and no per-card `Button`, unless each feature links to a materially different
destination. <!-- rule:forge-ui-marketing-card-feature-group -->

Default: an FAQ renders as an `Accordion` rather than as stacked `Card`s, unless every answer is
short enough that all of them fit on screen at once. <!-- rule:forge-ui-marketing-accordion-faq -->

Default: a notice bar uses `Alert` with `default` or `info`, unless the notice reports a real
service failure, which is the one case `destructive` is earned. <!-- rule:forge-ui-marketing-alert-notice -->

Default: a capture form opens in a `Dialog` triggered by an explicit control, and never on a timer,
a scroll position, or an exit-intent listener, unless the brief specifies the trigger. <!-- rule:forge-ui-marketing-dialog-capture -->

### Before / after — the hero

```tsx
import { Badge, Button, Card } from "@y-core/forge/ui/core";

<Card class='p-6'>
  <Card.Header>
    <Badge variant='default'>New</Badge>
    <Card.Title>Ship faster</Card.Title>
    <Card.Description>Trusted by 12,000 teams. 312% faster deploys.</Card.Description>
  </Card.Header>
  <Card.Footer>
    <Button variant='primary'>Start free trial</Button>
    <Button variant='primary'>Book a demo</Button>
  </Card.Footer>
</Card>;
```

Costs the page everything a hero is for: a `Card` frames the message as one item among many rather
than as the page's thesis, the type steps are the app's, two `primary` buttons mean no primary
action, and the two numbers are invented — which is a Floor violation, not a taste note.

```tsx
import { Button } from "@y-core/forge/ui/core";

<section class='flex flex-col items-center gap-6 px-6 py-24 text-center'>
  <h1 class='max-w-prose text-3xl font-semibold text-foreground md:text-5xl'>Ship faster</h1>
  <p class='max-w-prose text-lg text-muted-foreground'>
    Deploy on every merge, with a rollback that takes one click.
  </p>
  <div class='flex gap-3'>
    <Button variant='primary' size='lg'>Start free trial</Button>
    <Button variant='ghost' size='lg'>Read the docs</Button>
  </div>
</section>;
```

Two text colors, one accent, the measure capped, and one claim — which happens to be true of the
product being described.

## What does not change

**Every Floor rule holds, unchanged, on a marketing page.** The dials of `12-density.md` are Tier 2
Defaults; the Floor has no tier above it and no brief reaches it. Specifically:

- `forge-ui-color-token-only` — a brand hue is expressed by overriding `--primary` in the app's
  stylesheet, not by writing a hex literal into a hero's `class`.
- `forge-ui-contrast-floor` — large display type at low contrast is the single most common
  marketing accessibility failure. 3:1 for large text, in both `:root` and `.dark`.
- `forge-ui-focus-ring` and `forge-ui-hit-target` — a landing page is still operated by keyboard,
  and a hero button is still a button.
- `forge-ui-reduced-motion` — motion at 5 is the setting most likely to produce a scroll-triggered
  animation, and every one of them needs a `motion-reduce:` path.
- `forge-ui-heading-order` — the hero `<h1>` is the page's only one, and section headings descend
  from it without a skip. Sizing is a class, never a tag choice.
- `forge-ui-one-radius` — a marketing page is not the place to introduce a second corner radius.

And the one that fails most often, stated hard:

**`forge-ui-no-fabricated-data` applies with full force here.** No invented metric, no invented
testimonial, no invented company logo, no invented person. "Trusted by 12,000 teams", "312% faster",
a quote attributed to a fictional VP of Engineering, an `Avatar` holding a stock face — every one is
a fabrication, and shipping it is worse on a marketing surface than anywhere else in the product,
because a marketing surface is a claim to a stranger.

Default: a proof element — a metric, a quote, a customer name, an `Avatar` — renders only when the
real value is supplied in the brief, and otherwise the element is omitted entirely rather than
filled with a placeholder. <!-- rule:forge-ui-marketing-no-invented-proof -->

Default: an `Avatar` on a marketing surface carries a real person's image or their real initials
through `Avatar.Fallback`, unless the brief supplies an explicitly illustrative image and says so. <!-- rule:forge-ui-marketing-avatar-real-person -->

Default: a section that has no real content yet is left out of the page rather than rendered with
sample content, unless the brief asks for a wireframe, in which case every placeholder is labelled
as one in the surrounding copy. <!-- rule:forge-ui-marketing-omit-unfilled-section -->

## Motion at 5

The raised motion dial buys entrance transitions on scroll and a longer duration on state changes.
It does not buy anything that moves without the user causing it.

Default: marketing motion is limited to one entrance transition per section and the state
transitions the platform's own selectors already express, and never includes a looping animation, an
auto-advancing carousel, or a parallax effect, unless the brief names the effect
specifically. <!-- rule:forge-ui-marketing-motion-ceiling -->
