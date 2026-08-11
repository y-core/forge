# Migration Guide

What a consuming app has to *do* for the releases that need more than a version bump.
`CHANGELOG.md` is the record of **what** changed; this file is **what to do about it**, and it only
carries the releases where that is not obvious from a compile error.

| Upgrade | What it needs | Size |
|---|---|---|
| **0.0.82 → 0.0.83** | Your theme import, if you have one — then a look at every screen, because every colour changes and `--primary` becomes a brand colour — plus your `--accent-12` override if you had one, two token checks, six silent hazards, and your page shell if you mount the log viewer | One import, then a design review |
| **0.0.80 → 0.0.81** | The `defineAction` schema pipeline — four silent hazards | An afternoon |

---

# 0.0.82 → 0.0.83 — a new colour scale, and forge now ships the dark custom-variant

**Start here: [what happened to your theme import?](#the-loud-break--one-theme-file-is-deleted-and-two-filenames-now-mean-something-else)**
One deleted file is the only thing in this upgrade that stops your build — and two of the surviving
filenames are now different files, which is the part that stops nothing. Everything else is silent, and the
largest of the silent things is that **every colour forge renders changes** — the neutral scale is
new end to end, so every surface, every border and every line of text lands on a new value. Budget a
look at your screens, not a grep.

**There is no line to add. Forge declares it.** `forge.css` now carries
`@custom-variant dark (&:where(.dark, .dark *));` after its theme imports, so the line this release
was going to ask you for is already in the stylesheet you import.

If you added it yourself — on the strength of 0.0.82, or of an earlier reading of this page —
**leave it**. It is the identical declaration and `@custom-variant` is last-declaration-wins, so
your copy restates forge's and there is nothing to remove and nothing to reconcile.

The work this release actually needs is the opposite one, and both halves of it are silent:

1. **If your app was deliberately on `prefers-color-scheme`,** forge has just taken that away — a
   custom variant is global, so it redefines `dark:` across your stylesheet too, not only forge's.
2. **If you override a semantic token per mode** — `:root { --primary: … }` against forge's `.dark`
   twin — that twin no longer exists, and your light value now carries into dark.

Neither of those is the entire migration, and neither is the largest part of it. **Every colour
changes** — see [the third break](#the-third-break--every-colour-changes) — and `theme-zinc.css` is
deleted, which is the one thing here your build will refuse.

Six further changes in 0.0.83 alter what renders without
altering any type — the `--sidebar*` tokens are deleted,
`collapsible="always"` now resolves a different `placement`, `Select` routes a caller's `class` to a
different element, `ToggleGroup.Item`'s default box changes size, `Slider` stops painting its filled
portion, and a rail's layout classes move to a different box — and they are the six silent hazards
below. Three symbols also change in ways a compiler names — `mountNav` is removed,
`Collapsible.Trigger` gains a required `icon`, and `ToggleGroupItemSize` is removed in favour of
`ButtonSize` — and none of them gets an entry here, on purpose: an import that no longer resolves
and a missing required prop are compile errors, and this file covers only what a compiler will not
tell you. The rest of 0.0.83 is tokens, and the rendering changes are described in the changelog.

**The one exception to that rule is [the log viewer](#if-you-mount-the-log-viewer), at the end.** It
*is* a compile error, and it would normally be left to the compiler — but the error tells you a prop
is missing, not what to put in it, and what to put in it is a page shell. That is a worked example,
not a diagnostic.

## Why forge declares it rather than asking you to

The line was previously conditional — you needed it only if *your* app wrote `dark:` utilities. It
still is, in the sense that **forge writes none**. Every colour forge renders resolves through a
custom property, and the `.dark` block re-declares the role steps those properties point at, so a
forge component's dark mode arrives through the cascade rather than through a variant. The status
variants on `Alert`, `Toast` and `Badge`, and the `renderSuccess` / `renderError` /
`renderValidationErrors` banners in `@y-core/forge/http`, are the ones that used to be the exception;
they resolve through the `--status-*` family now, so the exception is gone.

What is left is the disagreement between two systems on the same page. **Forge's colours follow a
class. Tailwind's `dark:` follows the OS unless someone says otherwise.** Whoever declares
`@custom-variant dark` decides which — and it is a decision about *your whole stylesheet*, made in a
file one of you owns and the other imports. Leaving it to the consumer meant a requirement with
nothing to enforce it, whose only symptom is a rendering nobody sees until a user picks a theme that
is not `system`: on a dark-OS machine with the toggle set to `light`, every `dark:` utility in the
app renders its dark half against a light page. Forge holding its own half is one fewer of those.

**The cost is that a custom variant has no scope.** It is not "forge's `dark:`" that gets
redefined; it is `dark:` — every occurrence of it that Tailwind compiles for your app. That is a
takeover, and it is worth naming as one rather than filing under convenience.

## What happens if you were deliberately on `prefers-color-scheme`

**You lose it, and forge is what took it.** Tailwind v4 defaults `dark:` to `prefers-color-scheme`;
forge's declaration replaces that default for your whole stylesheet. An app with no theme class,
relying on the OS to pick — an entirely ordinary setup — now renders its light half for everyone,
because `.dark` is never on any element. Nothing errors, no class goes unmatched, and the utilities
are still generated. They just key off a class nobody sets.

The escape hatch is the same cascade rule that makes a consumer's own copy of the line harmless.
`@custom-variant` is last-declaration-wins, so re-declare it **after** the import:

```css
@import "@y-core/forge/ui/assets/css/forge.css";
@custom-variant dark (@media (prefers-color-scheme: dark));
```

Order is the whole fix — declared before the import, yours is the one that gets overwritten.

**Read what you are choosing, though.** Forge's tokens are class-driven and stay that way:
`theme-base.css` puts every dark value under `.dark`, and no `@custom-variant` reaches a CSS rule
written by hand. So with the media query restored, forge's components still follow the class while
**your** `dark:` utilities follow the OS — the disagreement described in the section above, now
running along the seam between your markup and forge's. For an app that wants automatic dark mode,
the durable
answer is the other one: keep forge's variant and drive `.dark` from the OS preference in a
pre-paint script, so the class and the OS agree by construction and a manual toggle can still
override both. `FOUC_SCRIPT` and `DARK_CLASS` from `@y-core/forge/ui/chrome` are the two halves of
that.

## Why forge cannot catch this for you

Forge has no Tailwind dependency — it ships raw TypeScript and no build step — so **nothing in its
gate ever compiles CSS**. No unit test, no browser spec and no validation script can observe what
your `dark:` resolves to, or whether anything ever puts `.dark` on your document. This one is on
you, and there is no diagnostic to wait for — in either direction, which is why the takeover is
stated here rather than left to be discovered.

## How to verify it in ten seconds

Set your OS to dark mode, set your app's theme toggle to light, and look at **one of your own
`dark:` utilities** — a `dark:bg-slate-900` panel in your own markup will do. It should render its
*light* half, because `.dark` is not on the document. If it renders dark, something has re-declared
the variant back to the media query; look at the **tail** of your stylesheet rather than its head,
because the last declaration is the one that counts. Forge's own components are no help here — they
carry no `dark:` utility and follow the class either way.

Then set the toggle to dark and look at anything you re-point in `:root`. If it renders its light
value, you are holding the second break, below.

## The second break — a per-mode `:root` override no longer flips under `.dark`

A 12-step role scale has replaced the `--palette-*` ramp under the semantic tokens, and it moved the
override point. The mapping used to be one hop, written twice:

```css
:root  { --muted-foreground: var(--palette-600); }
.dark  { --muted-foreground: var(--palette-300); }
```

It is now two hops, and only the lower one is per-mode:

```css
:root  { --muted-foreground: var(--gray-11); }   /* declared once, for both modes */
:root  { --gray-11: #646464; }
.dark  { --gray-11: #b4b4b4; }
```

**`--palette-50` … `--palette-950` no longer exist.** They are deleted, not renamed — earlier
guidance told you to supply a ramp, and that instruction is withdrawn. Nothing in forge reads the
stops any more, so a stylesheet that still declares them compiles, renders forge's own scale, and
gives you no sign that your ramp is inert. Delete it, or keep it for your own utilities knowing that
forge ignores it.

The values changed too, and comprehensively — see
[the third break](#the-third-break--every-colour-changes). What changed *here* is where a
per-mode decision can be expressed, and that is a separate hazard: an app that wrote
`:root { --primary: … }` was overriding a light-mode declaration that forge's `.dark` block then
overrode back. That block no longer declares `--primary`, so your value is now the value in **both**
modes. Nothing is unset and nothing errors; the light half simply carries into dark.

The fix is to re-point the step instead, which is the layer that is still mode-aware:

```css
/* before — forge's `.dark` twin flipped this back */
:root { --primary: var(--brand-600); }

/* after — say it per mode, at the step `--primary` resolves through */
:root { --accent-12: var(--brand-600); }
.dark { --accent-12: var(--brand-300); }
```

| If you overrode | Re-point |
|---|---|
| `--primary` | `--accent-12` |
| `--background`, `--foreground` | `--gray-1`, `--gray-12` |
| `--card`, `--popover` | `--gray-2` |
| `--secondary`, `--muted`, `--accent` | `--gray-3` |
| `--muted-foreground` | `--gray-11` |
| `--primary-foreground` | `--gray-1` |
| `--secondary-foreground`, `--accent-foreground`, `--card-foreground`, `--popover-foreground` | `--gray-12` |
| `--border` | `--gray-6` |
| `--input`, `--track` | `--gray-10` |
| `--ring` | `--gray-11` |
| `--overlay` | `--black-a6` |
| `--destructive`, `--success`, `--warning` | `--red-9`, `--green-9`, `--yellow-9` |
| `--destructive-foreground`, `--success-foreground`, `--warning-foreground` | `--red-contrast`, `--green-contrast`, `--yellow-contrast` |

Two of those rows are shared steps, and sharing is the mechanism rather than an accident.
`--input` and `--track` both name step 10, and each names it independently — so overriding
`--input` still moves only `--input`, while overriding `--gray-10` moves both. `--ring` and
`--muted-foreground` share step 11 the same way.

**`--accent-12` is where a brand hue goes.** It is an alias for `--gray-12` and forge ships no
accent of its own, so re-declaring it per mode is the supported way to give forge a brand colour —
that is why the alias exists rather than `--primary` naming a gray step directly.

**`--<hue>-contrast` needs no `.dark` half.** All three resolve to `var(--gray-1)`, and step 1 is
the page: near-white in light, near-black in dark, which are exactly the two answers a foreground
on a saturated fill needs. `--yellow-contrast` is the exception and stays near-black in both modes,
because near-white on `yellow-500` measures 1.83.

**No parked steps remain.** Earlier guidance said `--primary-foreground`,
`--secondary-foreground` and `--accent-foreground` resolved through steps that carried no role and
would be re-pointed later. They are on real steps now — `--gray-1` and `--gray-12` — and are in the
table above like everything else.

**An override that was always meant to hold in both modes needs no change at all.** If you set a
value in `:root` and never wrote a `.dark` counterpart, it behaved as a both-modes value before and
behaves as one now. This break is specifically about relying on forge's twin to undo your `:root`.

```bash
rg -n '^\s*--(background|foreground|card|popover|primary|secondary|muted|accent|border|input|track|ring)' --glob '*.css'
```

**Downstream symptom:** a brand colour that was correct in both modes is now the light value on a
dark page — legible or not depending on the hue, and with no build error, no unset variable and no
unmatched class anywhere. `validate-contrast` refuses an audited token declared in `.dark` at all,
so forge's own theme files cannot drift back to the old shape; your stylesheet is outside that gate.

Forge also gained a `--status-*` family in this release — twenty fixed status-hue tokens forge owns,
distinct from `--destructive` / `--success` / `--warning`, which stay yours to re-point. `Alert`,
`Toast`, `Badge` and the `@y-core/forge/http` banners resolve through it. **Nothing you do changes
because of that** — those four already used fixed hues rather than `--destructive`, so re-pointing
`--destructive` never re-tinted a status panel and still does not. What is new is that the fixed
hues are now tokens you can reach: if you *want* to re-tint an error panel, `--status-danger-*` is
where to do it, and `--status-danger-strong` is the chip tier a `Badge` reads.

## The loud break — one theme file is deleted, and two filenames now mean something else

`theme-zinc.css` no longer exists. An `@import` of it fails to resolve, so this is the single thing
in the upgrade your build will refuse — which is the outcome worth having, because the alternative is
a stylesheet that silently stops overriding anything.

**`theme-gray.css` and `theme-neutral.css` kept their filenames and are entirely different files.**
They used to be `--palette-*` ramps; they are scheme files now. Your import still resolves, so
nothing fails, and what you get is a different scheme from the one that filename used to mean. That
is the row of this table to read twice.

```bash
rg -n 'theme-(gray|zinc|neutral|slate|stone|mist|olive)\.css'
```

| You imported | Do |
|---|---|
| `theme-neutral.css` | **Delete the import.** `forge.css` imports it for you now — it is the default scheme. Keeping it restates the default and changes nothing |
| `theme-gray.css` | **Decide.** Same filename, new file: it is now the **cool** scheme, Tailwind's `gray` hue. Keep it if you want cool; delete it for the achromatic default |
| `theme-zinc.css` | Switch to `theme-stone.css`, or delete the import. Zinc has no successor |
| `theme-slate.css` | Keep it. The values change, and it is visibly cooler than it was |
| `theme-stone.css` | Keep it. The values change, and it is visibly warmer than it was |

**A theme file is no longer required at all.** `forge.css` imports `theme-neutral.css` — the default,
achromatic scheme — for you, so forge renders correctly with nothing else imported. That is a setup
step deleted rather than moved, and it is why the `theme-neutral` row above says delete rather than
replace.

**If you are choosing rather than migrating**, four schemes ship and they differ only in how far they
lean. Measured as max−min across R/G/B at step 11, the muted-text step:

| Import | Tint at step 11 | Character |
|---|---|---|
| *(none — the default)* | 0 | Achromatic |
| `theme-stone.css` | 12 | Warm |
| `theme-gray.css` | 20 | Cool |
| `theme-slate.css` | 42 | Strongly cool |

**Tailwind's ramp named `gray` is blue-tinted**, so `theme-gray.css` is the cool scheme and the
achromatic one is `theme-neutral.css`. The names invite the opposite reading, and that is the single
likeliest way to pick the wrong file here.

If you were on `theme-zinc.css`, one thing it was doing for you is worth knowing about: it re-pointed
`--warning` to `orange-700`. If you want that back, re-declare `--yellow-9` (and `--yellow-contrast`,
per mode, checking the contrast yourself) — but read the changelog entry on that file first. Its dark
warning foreground rendered near-white on orange at **2.77:1**, in every release that shipped the
file, because its `:root` override won in both modes.

`package.json` exports `./ui/assets/css/*.css` by wildcard, so no import path changes shape and the
export map needed no edit.

## The third break — every colour changes

**This is the largest visual change in the release, and nothing will tell you about it but your own
eyes.** Forge's neutral scale moved off the old Tailwind ramps onto a new one, carried as literal
values: every step takes its **lightness** from Radix Colors and, in the three tinted schemes, its
**chroma and hue** from Tailwind's `stone`, `gray` and `slate` ramps resampled at that lightness.
Every
surface, every border, every line of text on a forge component lands on a new colour. There is no
compile error, no unset variable and no unmatched class — the page simply renders differently.

What to look at, in rough order of how noticeable it is:

| What | What happens |
|---|---|
| Everything neutral | New scale end to end. The default scheme is achromatic; `theme-stone.css` is warm, `theme-gray.css` cool and `theme-slate.css` strongly cool, and all three carry a **visible** tint rather than the near-neutral they used to |
| `--input`, `--ring` | **Lighter** than they were mid-audit — 4.34 → 3.33 and 6.87 → 5.19 in light — and still clear of the 3:1 floor 1.4.11 binds them by. Against 0.0.82 they are still far stronger; the shipped dark `--input` measured 1.70:1 |
| `--foreground` | Slightly stronger: 14.30 against `--muted` |
| `--border` | Quieter. It keeps the decorative step, which on the new scale is a fainter hairline than the old ramp drew |
| Light-mode cards | **Still raised.** `--card` stays lighter than `--background`, which took a deliberate swap of steps 1 and 2 in the light block — Radix reads step 2 as one shade toward the foreground, which would have made a panel recede |
| The dialog scrim | `rgb(0 0 0 / 0.5)` becomes `var(--overlay)`, which is `--black-a6` at 0.4 — marginally lighter, and now overridable without touching a component rule |
| Status panels and chips | Unchanged. `--status-*` is still on Tailwind stops; only the greys moved |

**If you ship more than one scheme, the difference between them is now legible.** Three tokens, as
they resolve in a Tailwind 4.3.3 build of each scheme (light / dark):

| | `--background` | `--muted-foreground` | `--border` |
|---|---|---|---|
| `theme-neutral.css` (default) | `#f9f9f9` / `#111111` | `#646464` / `#b4b4b4` | `#d9d9d9` / `#3a3a3a` |
| `theme-stone.css` | `#f9f9f8` / `#13100f` | `#69635d` / `#b8b3af` | `#dcd8d6` / `#3e3935` |
| `theme-gray.css` | `#f8f9fa` / `#0b111c` | `#5d6571` / `#afb5bd` | `#d6d9de` / `#323b48` |
| `theme-slate.css` | `#f7f9fb` / `#081023` | `#54657e` / `#a7b6c9` | `#d1dae6` / `#2c3b51` |

**What that does not cost you is contrast.** All four schemes sit on one lightness ramp and differ
only in hue, so every ratio forge audits is the same across them to within 0.05 — the widest gap at
any audited step is `--muted-foreground` in light, at 5.17 gray, 5.19 neutral, 5.20 stone and 5.22
slate. Switching scheme cannot drop a pair below its floor. That is the construction rather than four
separate measurements: `theme-gray.css` was added, and later re-tuned to 0.8 chroma, without a single
audited ratio being re-pinned. A scheme you author yourself is on its own ramp and carries no such
guarantee.

**A pixel-comparison run is the check.** If you keep visual-regression baselines, every one of them
that contains a forge component will need regenerating, and the diff is real rather than noise.

## The fourth break — `--primary` is a brand colour, and your `--accent-12` override is inert

**`Button variant='primary'` was near-black. It is indigo now.** This is a second visual change on
top of the one above, and unlike that one it has a thing to *do* if you had supplied your own brand
colour.

Forge shipped no accent, so `--accent-12` was aliased to `--gray-12` and `--primary` resolved
through it. The comment beside that alias named it as the extension point: re-declare one property
and you have a brand. Forge ships a real `--accent-1…12` scale now, and `--primary` resolves through
**step 9**, so that extension point has moved.

```diff
  :root {
-   --accent-12: #0b5fff;    /* silently does nothing now */
+   --accent-9:  #0b5fff;    /* the solid --primary paints */
+   --accent-contrast: var(--gray-1);   /* the text that sits on it */
  }
```

**Nothing errors.** `--accent-12` is still a real declared step — it is the accent scale's
high-contrast text — so your override still parses, still applies, and no longer reaches
`--primary`. Every primary button in your app silently becomes forge's indigo.

### What to do

| If you… | Do this |
|---|---|
| Never touched `--accent-12` | Nothing, but look at your primary buttons — they went from near-black to indigo. |
| Overrode `--accent-12` for a brand colour | Re-declare `--accent-9` (the solid) and `--accent-contrast` (its foreground). Two properties instead of one. |
| Want a complete brand scale | Declare all twelve `--accent-*` steps plus the twelve `--accent-a*` alpha steps in a scheme file, the same shape `theme-neutral.css` uses. The customiser at `/showcase/ui/theme` generates one and emits it ready to paste. |

**Check the contrast if you supply your own step 9.** `--primary-foreground` is an audited pair now
— WCAG 1.4.3 binds it, because a primary button is text on a filled surface — and forge's own values
measure 5.48:1 in light and 4.97:1 in dark. Your brand colour is not covered by that measurement.
The customiser reports the ratio live for a generated scheme; for a hand-picked hex, measure it.

**Why forge's step 9 is not exactly Radix indigo's.** Accents do not invert their solid between
modes, so `--accent-contrast` must be near-white in both — and on indigo's own step 9, forge's
near-white dark step measures 4.49:1, under the floor. Forge's step 9 is one notch darker so the
margin is real rather than a rounding artifact. If you author your own, the same constraint applies
to you: one solid, one near-white foreground, measured in the mode where it is tightest.

## Silent hazard 1 — the `bg-sidebar` utilities stop being generated

The eight `--sidebar*` tokens are deleted, and so are the eight `--color-sidebar*` aliases that
bridged them into `@theme inline`. No forge component read any of them, so nothing forge renders
changes. What changes is Tailwind's output: the bridge run is what makes `bg-sidebar`,
`text-sidebar-foreground`, `border-sidebar-border` and the rest of that family exist as utilities at
all. Without it they are unmatched class names — which is not an error in Tailwind, it is just an
element with no styling.

```bash
rg -n 'sidebar' --glob '*.tsx' --glob '*.ts' --glob '*.html' --glob '*.css'
```

**Downstream symptom:** a panel that was `bg-sidebar text-sidebar-foreground` renders transparent
with inherited text colour, on the page background, at whatever contrast that happens to give. The
build succeeds, the class attribute still contains the name, and any test grepping the markup for
`bg-sidebar` still passes.

If you used them, declare them in your own stylesheet — all three runs, because the `@theme inline`
half is the one that generates the utilities:

**The 0.0.82 declarations cannot be pasted back verbatim**, because every one of them named a
`--palette-*` stop and that ramp is deleted (see [the second break](#the-second-break--a-per-mode-root-override-no-longer-flips-under-dark)).
Re-pointed onto the role scale, the same eight tokens are one block rather than two — a step is
mode-aware, so there is no `.dark` twin to write and the dark `--sidebar-primary` literal
`oklch(0.488 0.243 264.376)` has nowhere to go:

```css
:root {
  --sidebar:                       var(--gray-2);
  --sidebar-foreground:            var(--gray-12);
  --sidebar-primary:               var(--accent-12);
  --sidebar-primary-foreground:    var(--gray-1);
  --sidebar-accent:                var(--gray-4);
  --sidebar-accent-foreground:     var(--gray-12);
  --sidebar-border:                var(--gray-6);
  --sidebar-ring:                  var(--ring);
}

@theme inline {
  --color-sidebar:                     var(--sidebar);
  --color-sidebar-foreground:          var(--sidebar-foreground);
  --color-sidebar-primary:             var(--sidebar-primary);
  --color-sidebar-primary-foreground:  var(--sidebar-primary-foreground);
  --color-sidebar-accent:              var(--sidebar-accent);
  --color-sidebar-accent-foreground:   var(--sidebar-accent-foreground);
  --color-sidebar-border:              var(--sidebar-border);
  --color-sidebar-ring:                var(--sidebar-ring);
}
```

These are the 0.0.82 *roles* rather than the 0.0.82 pixels — the shades move with the new scale, as
everything else does. They depend on `--gray-*`, `--accent-12` and `--ring`, so keep the block after
the forge theme import. Re-declaring is the compatibility path, not the recommended one: nothing in
forge maintains these any more, and a panel is usually better expressed with `--card` or `--muted`,
which are audited.

## Silent hazard 2 — `collapsible="always"` renders a different bar, under different ids

`Navbar`'s `placement` now defaults per collapse mode. With `collapsible="always"` and no explicit
`placement`, it used to resolve to `"top"` — a full-width top strip that stayed permanently behind a
hamburger — and now resolves to `"left"`, taking the left-rail classes. `collapsible` anything else
still defaults to `"top"`, and `Toolbar` is not affected: its own `placement` default was already
`"left"`.

Two things move, and neither is a type error:

| What moves | Fix |
|---|---|
| The class string — a top strip becomes a left rail | Pass `placement="top"` |
| Generated ids — `navbar-menu-top-*` → `navbar-menu-left-*`, `navbar-group-top-*` → `navbar-group-left-*` | Pass an explicit `id` |

The ids move because `idBase` falls back to the *resolved* placement when no `id` is given. An
explicit `id` takes precedence over the placement in the same expression, so setting one pins the
prefix against this and any future default change — which is the better fix if anything outside the
component names those ids.

**Downstream symptom of the first:** a navigation bar that changes edge on the next deploy, with a
correct-looking diff of zero. **Of the second:** an htmx target, a `document.getElementById`, a CSS
rule or a test selector naming `navbar-menu-top-0` that now matches nothing — and matching nothing
is silent everywhere except the test.

```bash
rg -n 'collapsible="always"' --glob '*.tsx'
rg -n 'navbar-menu-|navbar-group-'
```

## Silent hazard 3 — a `class` on `Select` now lands on the wrapper, not the `<select>`

`Select` renders two elements: a `<div data-slot='select-wrapper'>` that holds the width and the
containing block the chevron is positioned against, and the `<select>` inside it. A caller's `class`
used to land on the inner control. It now lands on the wrapper — which is the case the wrapper exists
for, because `class='w-64'` previously sized the inner control and left the box that is actually laid
out at its content width.

Every other forwarded prop is unaffected: native attributes, `data-*` hooks and ARIA relations still
reach the `<select>`, because those are about the control rather than the box around it. `class` is
the single split, recorded as a `classSlot` in `conformance.test.tsx`.

| What you passed | Where it lands now | What to do |
|---|---|---|
| A geometry utility — `w-*`, `max-w-*`, `col-span-*`, a margin | The wrapper | Nothing; this is the fix |
| An inherited text utility — `text-sm`, `font-*` | The wrapper, then inherits into the control | Usually nothing |
| A utility that paints a box — `border-*`, `bg-*`, `rounded-*`, `ring-*` | The wrapper, *behind* the control's own border and background | Move it into your own stylesheet keyed on `[data-slot~='select']`, or drop it |
| A padding utility — `px-*`, `py-*` | The wrapper, insetting the control rather than its text | Drop it; the control carries `px-3 py-2` |

**Downstream symptom:** a `Select` you had given a custom border or background renders with the
default control outline drawn on top of it, and the custom paint visible only as a ring of wrapper
showing past the control's edge. Nothing errors, and a test grepping the markup for the class name
still finds it — on a different element.

```bash
rg -n '<Select[^>]*class=' --glob '*.tsx'
```

## Silent hazard 4 — `ToggleGroup.Item`'s default size is a different box

`ToggleGroup.Item` no longer keeps its own size map. It resolves through
`buttonVariants({ variant: 'ghost', size })`, which means its `size` prop is now `ButtonSize` — the
full `sm` / `md` / `lg` / `icon` / `icon-sm` / `square` scale — and `sm` changes meaning.

| `size` | Was | Is now |
|---|---|---|
| `sm` (the default) | `size-[34px]`, a square | `h-8 px-3 text-sm`, the `Button` `sm` pill |
| `md` | `size-10`, a square | `h-10 px-4 text-sm`, the `Button` `md` pill |
| `lg` | `size-11`, a square | `h-12 px-6 text-base`, the `Button` `lg` pill |
| *(square boxes)* | — | `size='icon-sm'` is `size-8`; `icon` is `size-9` |

**An icon-only item must now pass `size='icon-sm'`.** Left at the default it becomes a wide pill with
a centred glyph and horizontal padding it did not have.

The `[&_svg]` descendant sizing goes with the map, and that is the second half: the item used to
resize any `svg` inside it — `18px` at `sm`, `20px` at `md`, `24px` at `lg`. It no longer does, so an
icon renders at whatever size it declares. **`Icon` declares none** — it emits `width` / `height`
only when you pass them, and an `<svg>` with neither falls back to the replaced-element default of
300×150. An icon that relied on the item to size it does not shrink or grow by a few pixels; it
takes over the row. Pass a size on the icon (`class='size-4'`, or `width` / `height`) at every
`ToggleGroup.Item` call site that renders one.

`ToggleGroupItemSize` is removed, so a module that *named* the type gets a compile error and is not
at risk here. A module that only passed a string literal compiles unchanged and re-renders at a new
size, which is the whole hazard.

**Downstream symptom:** a toolbar of icon toggles that was a row of squares becomes a row of wider
pills with smaller glyphs, and a strip sized to a fixed container starts to overflow or wrap.

```bash
rg -n '<ToggleGroup\.Item' --glob '*.tsx'
```

The item also gains the focus ring it never had, from the same button base. That is a fix rather than
a hazard, but it is a visible change on keyboard focus and it arrives without a diff in your app.

## Silent hazard 5 — `Slider` has no filled-progress portion any more

`Slider` used to paint its own box: a `bg-track` bar with `accent-primary`, which is what Chromium
and Firefox read to tint the track up to the thumb. Both are gone. The input is now a transparent hit
target — at least 32px across in both orientations, which is what makes it clear
`forge-ui-hit-target` — and the track and thumb are authored `::-webkit-slider-runnable-track` /
`::-moz-range-track` and thumb rules in `theme-base.css`. The track is **uniform**: one 8px
`--track` bar end to end, with a 16px `--primary` thumb on it carrying a `--background` halo.

Two things follow, and neither is a type change:

| What moves | Consequence |
|---|---|
| The fill is gone | Value is legible from thumb position only, as on an unstyled range input |
| The input's box is 32px in the cross axis, up from 8px horizontally and 20px vertically | A slider in a tight row is taller than it was, and a vertical one is wider |

**You must be importing `theme-base.css`.** The track and thumb are the only part of a forge
component that cannot be expressed as a utility class — no Tailwind utility reaches a UA
pseudo-element — so an app that hand-rolled its own token layer without the shipped sheet now renders
a `Slider` with **no visible track and no visible thumb**, on an element that is otherwise fully
functional and fully keyboard-accessible.

```bash
rg -n '<Slider' --glob '*.tsx'
rg -n 'theme-base.css'
```

**Downstream symptom:** a settings panel of sliders that read as progress bars now reads as bare
tracks, and the row they sit in grows by up to 24px each.

## Silent hazard 6 — a rail's width and border belong on the box the parent lays out

If you render `<Navbar collapsible="always">` as a rail, its layout classes move off the component
and onto the `Resumable` scope root — which takes a `class` as of this release for exactly that
purpose. `Navbar`'s own `class` lands on the `<details>`, two boxes inside the element your flex row
actually lays out. A width set there only ever *looked* right, because every box between happened to
size to its content, and a `shrink-0` set there guarded an element the flex algorithm was never going
to shrink.

The rail's own pinning depends on the same chain. `max-h-dvh` and `overflow-y-auto` cap nothing until
the `<details>` has a height to cap, and a percentage height resolves to `auto` the moment one
ancestor is `auto`. Forge now supplies the two links it owns — the scope root and the `<nav>` both
take `h-full` in rail mode — which leaves you owning exactly one: **a definite height on the box the
scope root sits in.** A stretched flex item in a `flex min-h-dvh` row is one.

```tsx
// Before — layout classes on the component, no height anywhere.
<Resumable name='app-rail'>
  <Navbar config={rail} resolveHref={routes.url} icon={AppIcon} collapsible='always' defaultOpen class='w-64 shrink-0 border-r border-border' />
</Resumable>

// After — layout on the flex item, height from its parent.
<div class='flex min-h-dvh'>
  <Resumable name='app-rail' class='w-64 shrink-0 border-r border-border has-[[data-slot~=navbar]:not([open])]:w-14'>
    <Navbar config={rail} resolveHref={routes.url} icon={AppIcon} collapsible='always' defaultOpen />
  </Resumable>
  <main class='flex-1 min-w-0'>…</main>
</div>
```

Write the collapsed width as an **override on a wide base**, never a narrow base widened when open: a
browser without `:has()` then degrades to the full column rather than pinning a 56px strip that clips
the open panel. The rail's toggle is also `sticky top-0` now, with `bg-background/95` behind it, and
sits at the leading edge while collapsed rather than the trailing edge.

**Downstream symptom:** nothing changes on its own — your existing markup renders as it did, which is
to say the rail still scrolls away with the page and still sizes to its content. The hazard is that
the changelog describes a pinned rail you will not get until the height chain is closed at your end.
`collapsible="mobile"` is untouched; none of this applies to it.

```bash
rg -n 'collapsible=.always.' --glob '*.tsx'
```

Design rationale for all three placements is `forge-ui-nav-rail-flex-item`,
`forge-ui-nav-rail-persists` and `forge-ui-nav-rail-collapsed-width` in
[`src/ui/design/reference/08-navigation.md`](src/ui/design/reference/08-navigation.md), and the
worked example is in [`src/ui/README.md`](src/ui/README.md).

## If you mount the log viewer

**If you do not mount `loadLogViewer`, skip this — nothing else in `logging` needs anything from
you.** If you do, the compiler stops you in one place, and this is what to put there.

`loadLogViewer` used to build its own `<html>`, `<head>` and `<body>`. That document had no dark
class, no pre-paint theme script and no `bg-background`, so the viewer could not render dark
**whatever** you configured — the `@custom-variant dark` line at the top of this page could not have
saved it, because nothing ever put `.dark` on that document. The shell is now yours, exactly as
`registerShowcase` has always taken it.

```diff
  export const logsPage = definePage<AppEnv, AppConfig>({
-   loader: (c) =>
-     loadLogViewer(c, {
+   loader: (c, config) =>
+     loadLogViewer(c, config, {
        channel: (cc) => kvLogChannel(cc.env.LOGS_KV!),
        access: (cc) => isAdmin(sessionCtx.getOptional(cc)),
        icon: chevronDownIcon,
+       context: renderContext,
+       layout: Layout,
        basePath: "/admin/logs",
      }),
    view: () => new Response(null, { status: 404 }),
  });
```

Three edits: `config` becomes the second argument, matching `definePage`'s own `(c, config, …)`
shape — which `context` needs — and `context` and `layout` are added. All three are compile errors,
so there is nothing here to grep for.

### The shell you now supply

If you already mount `registerShowcase`, pass it the **same** `context` and `layout`. They have
identical shapes, and that is deliberate. If you do not, this is the minimum that makes the viewer
render correctly in both modes:

```tsx
const Layout: FC<{ ctx: RenderContext }> = ({ ctx, children }) => (
  <html lang='en' class={ctx.theme === "dark" ? DARK_CLASS : undefined}>
    <head>
      <meta charset='utf-8' />
      <meta name='viewport' content='width=device-width, initial-scale=1' />
      <title>Request Log</title>
      <link rel='stylesheet' href={ctx.stylesheetHref} />
      <script nonce={ctx.nonce}>{FOUC_SCRIPT}</script>
    </head>
    <body class='min-h-dvh bg-background text-foreground'>{children}</body>
  </html>
);
```

Three parts are load-bearing: `DARK_CLASS` on `<html>`, `FOUC_SCRIPT` in the head — without it the
page paints light for one frame before the class lands — and `bg-background` on `<body>`. All three
come from `@y-core/forge/ui/chrome`.

### What the viewer looks like now

Nothing here needs action; it is listed so the change is not a surprise on first render. The viewer
is rebuilt on `ui/core` primitives and semantic tokens, replacing a hand-rolled `brand-*` palette
that forge never shipped and no consumer declared — so those utilities did not compile at all, and
the viewer had invisible borders and unreadable text in *light* mode too. Level chips are now `Badge`
variants, the table sits in a `Card` bounded by a `ScrollArea`, the empty state says which of its two
causes it is, a failed read renders a retry instead of blanking the table, and neither HTMX swap
drops keyboard focus.

One thing that has **not** changed: the viewer still writes classes of its own, so the
`@source "…/@y-core/forge/src/logging";` line in your stylesheet is still required.

---

# 0.0.80 → 0.0.81 — the `defineAction` schema pipeline

For a consuming app upgrading from **0.0.80** to **0.0.81**, the release carrying the `defineAction`
rewrite.

`CHANGELOG.md`'s `[0.0.81]` section is the record of **what** changed and is not repeated here.
This file covers **what to do**, and it is weighted deliberately: most of it is about the changes a
consuming app will *not* notice. The type errors announce themselves and a compiler will walk you
through them. The rest of this list keeps compiling, keeps returning `200`, keeps passing the test
suite — and behaves differently in production.

Read this alongside the rules it applies:

- [`.decisions/INPUT_VALIDATION.md`](.decisions/INPUT_VALIDATION.md) §1d — the schema contract, what
  each guard consumes, and the failure modes.
- [`.decisions/ROUTING_AND_MIDDLEWARE.md`](.decisions/ROUTING_AND_MIDDLEWARE.md) §2b — the
  derive-only drop rule, and why a permissive default was rejected.
- [`src/form/README.md`](src/form/README.md) and [`src/app/README.md`](src/app/README.md) — the
  worked examples and the current option tables.

---

## Which breaks announce themselves

| Break | How you find out |
|---|---|
| `parse` / `validate` replaced by `schema` | Compile error |
| `injectedFields` removed | Compile error |
| `readFields`, `readTextField`, `FormFieldReader` removed | Compile error |
| `onValidationError` receives issues, not strings | Compile error |
| `scopeAttrs` / `ScopeAttrsProps` moved to `ui/contracts` | Compile error — unresolved import |
| A `_csrf` submitted to a route with no `csrfProtection` | Every submission refused, at runtime |
| A missing `honeypot:` / `turnstile:` **on a strict schema** | Every submission refused, at runtime |
| A missing `honeypot:` / `turnstile:` on a **non-strict** schema | **Nothing.** Bot detection is gone |
| An implicitly-optional schema field | Nothing, until a user omits the field |
| A dropped `v.safeParse` config | Nothing |
| A hand-rolled `Object.fromEntries` body read | Nothing |
| A refusal body a client parses | Nothing — the *status* is unchanged |

The runtime refusals are loud by design: a submission that is refused every time is found on the
first manual test of the form. The bottom five rows are the substance of this guide.

---

## Silent hazard 1 — a field that was optional by accident now hard-fails

The removed `readFields` wrote `""` for a field the caller never sent. A schema field that was
*labelled* optional in the UI but declared as a plain string therefore validated fine: `""` passes
`v.maxLength`, and it passes any `*`-quantified `v.regex`. The absence was collapsed before the
schema could observe it.

`formToObject` leaves an absent field **absent**. `v.string()` then sees `undefined` and refuses,
and because a valibot object refusal is a refusal of the whole object, one omitted input rejects the
entire submission.

```ts
import { formText, v } from "@y-core/forge/validation";

// before — worked only because the reader substituted "" for an absent `phone`
phone: v.pipe(v.string(), v.trim(), v.maxLength(30), v.regex(/^[\d +-]*$/)),

// after — say what the form actually permits
phone: v.optional(v.pipe(formText(), v.maxLength(30), v.regex(/^[\d +-]*$/))),
```

**Downstream symptom:** a form that has always worked starts refusing whenever a user leaves an
optional input blank. The refusal is a correct `422` naming the field, so nothing looks broken — the
schema is simply now enforcing a rule the app never meant to state. It reproduces only for the
submissions that omit the field, so a filled-in smoke test passes.

Every field the markup does **not** mark `required` needs `v.optional` in the schema. Note also that
`v.optional(v.string())` accepts `""` as well as absence, which is what a browser sends for an empty
optional text input that *is* present — so `v.optional` is the right shape for both.

---

## Silent hazard 2 — the refusal status, and the workaround that must not survive

A consuming app that returned its own status for a refusal is the case to read carefully, because
the *before* and *after* are the same number and the conclusion "nothing to do" is wrong.

```ts
import { defineAction } from "@y-core/forge/app";
import { fragmentResponse } from "@y-core/forge/http";

// before — the app's own handler chose the status
const result = validateContact(formData);
if (!result.ok) return fragmentResponse(renderValidationErrors(result.error), 422);

// after — the pipeline answers 422 itself; the route never sees the failure
export const contactAction = defineAction<typeof ContactSchema, Bindings, AppConfig>({
  schema: ContactSchema,
  handle: async (data) => { /* reached only through a passing safeParse */ },
});
```

Two things did change underneath the unchanged status:

- **The body is different.** It carries one `<li>`, naming the failing field and nothing else — no
  valibot message, no rejected value, no pattern source. A client or a test that read the message
  text is reading something that is no longer there.
- **`abortEarly` holds it to one issue** however many fields a caller broke, so a per-field error
  list rendered from the default fragment now shows the first failure only. Supply
  `onValidationError` if enumerating is genuinely wanted, and bound it deliberately.

**The double-correction.** Between the schema rewrite and the status fix, the default fragment
carried no status and `fragmentResponse` defaults to `200` — so a refusal answered **`200`**. That
window was never released; both changes land in the same release. But an app tracking forge's main
branch through it, as the pre-1.0 same-window policy encourages, may have compensated for the `200`:
detecting a refusal by inspecting the response body, adding a `{ code: "200", swap: true }` htmx
entry, or dropping a `422` entry that had become dead. **Every one of those must come out now**, and
none of them shows up as a diff against 0.0.80 — the workaround and the fix cancel, so the app looks
migrated while the client is decoding the wrong signal.

**Downstream symptom of an uncorrected workaround:** a refusal that swaps twice, swaps the wrong
fragment, or is counted as a success by whatever reads the status — with no error anywhere.

---

## Silent hazard 3 — `v.safeParse` config is not carried over, and the flag names differ

`defineAction` calls `v.safeParse` itself with `{ abortEarly: true }`. Any config the app used to
pass is simply gone.

```ts
import { v } from "@y-core/forge/validation";

// before — the app's own call, with its own config
const result = v.safeParse(ContactSchema, raw, { abortPipeEarly: true });

// after — the pipeline's call, which the route does not supply config to
// { abortEarly: true }
```

**`abortEarly` and `abortPipeEarly` are two different flags.** Both are declared on valibot's
`Config`, and they are one letter apart in effect as well as in spelling:

- `abortEarly` — stop the whole validation at the first issue. **One** issue, total.
- `abortPipeEarly` — stop each *pipeline* at its first issue, and carry on to the next entry. One
  issue **per failing field**.

An app that wants a different shape passes `onValidationError` and runs its own `v.safeParse`.
Passing the wrong flag there is not an error and produces no warning — it produces a longer response
than intended, which is the amplification `abortEarly` exists to close: extra field names an
attacker adds multiply the issue count, and every issue is emitted.

**Downstream symptom:** a refusal body that grows with what the caller sent. Nothing fails; the
response is just steerable by the submission.

---

## Silent hazard 4 — `Object.fromEntries` is last-wins, and that is exploitable

`Object.fromEntries(formData)` is the obvious hand-rolled replacement for the removed reader. It is
wrong in a way no test written against a well-formed body can see.

| Reader | `email=victim@x&email=attacker@y` yields |
|---|---|
| `readFields` (removed) — `formData.get` | `"victim@x"` — **first**-wins |
| `Object.fromEntries(formData)` | `"attacker@y"` — **last**-wins |
| `formToObject(formData)` | `["victim@x", "attacker@y"]` — an array |

```ts
import { formToObject } from "@y-core/forge/form";

// before — first-wins, via formData.get under the hood
const raw = readFields(formData, ["name", "email", "message"]);

// wrong — silently last-wins, and the duplicate disappears
const body = Object.fromEntries(formData);

// after — the reader defineAction uses, public for handlers outside it
const body = formToObject(formData, { drop });
```

**Why this is a vulnerability and not a nit.** A scalar schema field fed an array refuses in its own
words, so `formToObject` turns a duplicated key into a visible `422`. Last-wins turns it into a
*successful* request carrying the attacker's value. Where the submitted value is echoed into an
outbound message — a `reply_to` on a contact email is the canonical case — an attacker appends a
second `email` field and redirects the reply, and the form reports success to the victim who filled
it in. First-wins is not safe either; it merely fails in the victim's favour by luck.

**This audit is not scoped to `defineAction` call sites.** A route inside the pipeline is already
correct. The exposure is every place the app reads a body by hand — a webhook receiver, an API
endpoint, a route that could not use `defineAction`. `formToObject` is exported from
`@y-core/forge/form` precisely so those handlers have a correct primitive to call rather than an
incorrect one to copy; see [`src/form/README.md`](src/form/README.md) for the `drop` set a CSRF
guard makes necessary.

**Downstream symptom:** none. The request succeeds, the log line looks ordinary, and the wrong value
is the one that was used.

---

## The loud break — `honeypot:` and `turnstile:` are now required arguments

For any route whose view renders a decoy or the Turnstile widget, the action must name the field:

```tsx
import { defineAction } from "@y-core/forge/app";
import { Honeypot } from "@y-core/forge/ui/core";

export const CONTACT_DECOY = "company"; // one app-owned constant, referenced twice

// view
<Honeypot field={CONTACT_DECOY} />

// action
defineAction<typeof ContactSchema, Bindings, AppConfig>({
  schema: ContactSchema,
  honeypot: CONTACT_DECOY,
  turnstile: { secretKey: (_c, config) => config.services.turnstile.secretKey, verify: (c) => ({ expectedHostname: c.url.hostname }) },
  handle: async (data) => { /* … */ },
});
```

Both checks moved into the pipeline, and **each field is dropped because it was checked**. A route
that does not name them gets neither the check nor the strip — so on a `strictObject` schema the
decoy arrives as an undeclared key and every submission is refused. That is the intended direction
to fail in, and it is the reason this break is listed apart from the four above.

**It is loud only on a strict schema.** Both options are optional in the *type* — there is no
compile error, by necessity, since a form with no decoy must stay valid. On a plain `v.object` an
undeclared field is silently dropped, so an app that has not adopted `strictObject` gets no refusal,
no compile error, and **no bot detection**: the pipeline previously stripped the honeypot field
before validation without ever checking it, and forge ships no honeypot or Turnstile middleware to
fall back on. Bot detection did not degrade on migration — it disappeared. Adopt `strictObject` and
this hazard converts itself into the loud one.

There is deliberately no default for `honeypot` and no reserved field-name prefix. A decoy works
only while its name is unpredictable, and forge is open source — any name forge published would be a
one-line bypass for every deployment at once. `HONEYPOT_FIELD_DEFAULT` exists and is public, which
is exactly why an app should not use it.

Two further consequences worth checking before the upgrade lands:

- **`Honeypot` no longer renders `data-slot="form-honeypot"`.** An attribute that names the decoy
  outright makes hardening the field name largely moot. There is no replacement — a consumer
  selector or test asserting on it breaks, by design.
- The field names forge does own live in
  [`src/form/constants.ts`](src/form/constants.ts); read them from there rather than restating the
  literals.

---

## The other loud break — `scopeAttrs` moved subpath

`scopeAttrs` and `ScopeAttrsProps` are now exported from `@y-core/forge/ui/contracts` instead of
`@y-core/forge/ui/server`. Both are published subpaths, so the old import stops resolving. The
symbols and their signatures are unchanged — change the path and nothing else:

```ts
// before
import { scopeAttrs, type ScopeAttrsProps } from "@y-core/forge/ui/server";
// after
import { scopeAttrs, type ScopeAttrsProps } from "@y-core/forge/ui/contracts";
```

```bash
rg -n 'scopeAttrs|ScopeAttrsProps'
```

---

## The diagnostic — an absent `csrfProtection` now refuses `_csrf`

Nothing is dropped on a guess. `csrfProtection` publishes the field it took the token from on
`csrfFieldCtx`, and the pipeline drops exactly that. Absent `csrfFieldCtx` means no guard ran, so
nothing consumed the field — and a submitted `_csrf` is an ordinary undeclared field a strict schema
is right to refuse.

Read this as the report it is, not as a regression. A form rendering a CSRF token against a route
where the middleware was never mounted was **already** unprotected; the token was decoration. What
changed is that the mismatch is now visible on the first submission instead of being absorbed
forever. The fix is to mount the guard, not to relax the schema. A permissive default and a blanket
`403` were both considered and rejected —
[`.decisions/ROUTING_AND_MIDDLEWARE.md`](.decisions/ROUTING_AND_MIDDLEWARE.md) §2b has the argument.

A route that renamed the CSRF field declares the new name **once**, to `csrfProtection`'s
`tokenField`. Nothing declares it a second time; that is what removing `injectedFields` bought.

---

## Tests to add, and one to rewrite

**Add a filled-honeypot rejection test per protected route.** This is the single test that makes the
`honeypot:` hazard non-silent for an app on a non-strict schema, and it is cheap: post a body with
the decoy field filled and assert the refusal.

```ts
it("refuses a submission with the decoy field filled", async () => {
  const res = await app.request("/api/contact", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: token, [CONTACT_DECOY]: "bot", name: "Jane", email: "j@x.test", message: "…" }),
  }, MINIMUM_ENV);

  expect(res.status).toBe(422);
});
```

Assert the status, not the body text: the refusal a tripped guard renders is byte-identical to the
one a real validation failure renders, deliberately, so that a bot cannot tell a guard from a
mistyped field by comparing them. A test that pins the body to a guard-specific string is asserting
a property forge does not have.

**Rewrite the contract test that pinned rendered field names against `readFields` — do not delete
it.** It was the right test: it caught a drift between what the view submits and what the handler
reads, which crafted-body worker tests structurally cannot see. `readFields` no longer exists, so
the contract now sits between the view and the **schema**:

```ts
import { CSRF_FIELD_DEFAULT, TURNSTILE_FIELD_DEFAULT } from "@y-core/forge/form";

const rendered = [...html.matchAll(/<(?:input|textarea)\b[^>]*\bname="([^"]*)"/g)].map((m) => m[1]);
const declared = Object.keys(ContactSchema.entries);
const injected = [CSRF_FIELD_DEFAULT, CONTACT_DECOY, TURNSTILE_FIELD_DEFAULT];

expect(rendered.filter((n) => !injected.includes(n))).toEqual(declared);
```

The three injected names are excluded because the pipeline drops each of them before validation, so
the schema declares none. Keeping them in the assertion as an explicit list is the point: it fails
if the view stops rendering one, which is the drift that matters.

---

## Audit checklist

Each item is a check to run, not advice. Run them against the consuming app.

**1. Every `defineAction` call site.** Confirm each has `schema`, and `honeypot` / `turnstile` where
its view renders those fields.

```bash
rg -n 'defineAction' --glob '*.ts' --glob '*.tsx'
```

**2. Removed symbols.** These are compile errors, but the grep is faster than the compiler and tells
you the size of the job.

```bash
rg -n 'readFields|readTextField|FormFieldReader|injectedFields|form-honeypot'
```

**3. Every hand-rolled body read.** Each hit is a last-wins or first-wins reader to replace with
`formToObject`. Include webhook and API handlers, not only form routes.

```bash
rg -n 'Object\.fromEntries|formData\.get\(|formData\.getAll\(|\.entries\(\)'
```

**4. Every schema field that is optional in the form but not in the schema.** List the inputs the
markup does not mark `required`, then confirm each corresponding schema field is `v.optional`.

```bash
rg -n '<(input|textarea)' --glob '*.tsx' | rg -v 'required'
rg -n 'v\.pipe\(' -A 1 --glob '*model*'
```

**5. Every route rendering a decoy or the Turnstile widget.** Each needs the matching option on its
action; each rendered field name must be the same app-owned constant the action names.

```bash
rg -n '<Honeypot|mountTurnstile|cf-turnstile|turnstileSiteKey|HONEYPOT_FIELD_DEFAULT'
```

**6. Every place a `200`-from-a-refusal was worked around.** Restore a `422` entry, remove any `200`
entry added for this path, and delete any body-inspection that stood in for a status check.

```bash
rg -n 'responseHandling' -A 10
rg -n 'abortPipeEarly'
```

**7. Every test asserting a refusal's status or body.** A status assertion is likely still correct; a
body assertion reading a valibot message, a rejected value, or a per-field list is not.

```bash
rg -n 'toBe\(4[0-9][0-9]\)|toBe\(200\)' --glob '*.test.ts*'
rg -n 'issue\.message|issues\.map|formatValidationIssues|renderValidationErrors' --glob '*.test.ts*'
```

**8. Every `csrfProtection` mount against every form that renders a token.** A form rendering
`_csrf` on a route with no guard now refuses every submission.

```bash
rg -n 'csrfProtection'
rg -n 'csrfToken|_csrf|CSRF_FIELD_DEFAULT'
```

**9. `formatValidationIssues` in any response path.** It reproduces `issue.message` and is an
internal diagnostic. Map through `describeValidationIssue` for anything a caller reads.

```bash
rg -n 'formatValidationIssues'
```

**10. `v.strictObject` adopted as `strictObject`.** The `validation` export corrects the inherited
key set that raw `v.strictObject` does not; the opt-in is visible at the call site.

```bash
rg -n 'v\.strictObject'
```

**11. `scopeAttrs` imported from `ui/server`.** The symbols moved to `ui/contracts`; only the import
path changes.

```bash
rg -n "ui/server'|ui/server\"" -A 2 | rg -n 'scopeAttrs|ScopeAttrsProps'
```
