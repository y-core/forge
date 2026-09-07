# Preflight

Run this against your own output, before you report the work as done.

Every item here produces a **number or a yes/no with the evidence beside it**. That is the whole
design of this file: a checklist of judgements ("is the hierarchy clear?") is answered by whoever
wrote the surface, in their own favour, every time. A checklist of counts is not.

Every item names the rule it enforces. A finding is reported as that id, in the line shape
`forge-ui-review-report-line` fixes.

Where a command is given, run the command. Scope it to the files you changed.

---

## Block 1 — Floor

Non-negotiable. Twenty-two items, no overrides, and a failure here outranks everything in Block 2.

1. **Name** the Design Read you emitted: who the surface is for, the one primary action, what
   failure looks like. Expect three answers, written before the markup. `forge-ui-design-read`
2. **Count** blocks of body copy with no `max-w-prose` or explicit `max-w-*` ancestor. Expect 0.
   `forge-ui-measure-cap`
3. **Name** every foreground/background token pair on the surface and its measured ratio in each
   mode. Expect ≥ 4.5:1 for body text and ≥ 3:1 for large text and UI boundaries, in both.
   `forge-ui-contrast-floor`
4. **Count** status indications carried by colour with no icon and no word beside them. Expect 0.
   `forge-ui-not-color-alone`
5. **Grep** `rg 'outline-none'` and, for each hit, name the replacement ring on the same element.
   Expect every hit paired with `focus-visible:ring-2 focus-visible:ring-ring`. `forge-ui-focus-ring`
6. **Count** interactive elements whose box is smaller than the `Button` `sm` box. Expect 0.
   `forge-ui-hit-target`
7. **Count** authored motion declarations, then count those gated by `motion-safe:` with a
   `motion-reduce:` settled state. Expect the two numbers equal:
   `rg -o 'transition-|animate-' | wc -l` against `rg -o 'motion-safe:' | wc -l`.
   `forge-ui-reduced-motion`
8. **Count** collection surfaces, then count designed empty states. Expect equal. `forge-ui-empty-state`
9. **Count** controls with no visible text, then count those carrying an `aria-label` or an
   `sr-only` span. Expect equal. `forge-ui-accessible-name`
10. **List** heading levels in document order: `rg -o '<h[1-6]|level=\{[1-6]\}'`. Expect no gap
    between consecutive entries. The second alternative is not optional — a heading rendered through
    `EmptyState.Title level={1}` has no `<h1>` in the source to grep for.
    `forge-ui-heading-order`
11. **Grep** `rg 'bg-\[#|text-\[#|border-\[#|rgb\(|hsl\(|oklch\('`. Expect 0 hits.
    `forge-ui-color-token-only`
12. **Grep** `rg 'style='`. Expect 0 hits — forge's SSR renderer drops the attribute silently.
    `forge-ui-no-inline-style`
13. **Grep** `rg -o '\b[a-z]+-\[[0-9]' | wc -l` for arbitrary sizing and spacing values. Expect 0.
    `forge-ui-spacing-scale-only`
14. **Grep** `rg 'h-screen|w-screen'`. Expect 0 hits; `min-h-dvh` is the replacement — a Floor rule
    that carries no id, because two class names are a restriction list rather than a rule.
15. **Count** `Card` elements that have a `Card` ancestor. Expect 0. `forge-ui-no-nested-card`
16. **Count** background token utilities, then count paired foregrounds on the same element or its
    parent. Expect equal, and expect `rg 'text-white/|text-black/'` to return 0 hits.
    `forge-ui-foreground-pairing`
17. **Count** distinct text colour utilities per surface. Expect at most 2. `forge-ui-text-color-budget`
18. **List** every corner-radius utility used: `rg -o 'rounded[a-z-]*'`. Expect every one to be a
    step of the `--radius` family, and no arbitrary value. `forge-ui-one-radius`
19. **Grep** `rg '<svg'` and scan the same files for emoji characters. Expect 0 of each; glyphs come
    from `Icon` or a `createIcon` binding. `forge-ui-real-icons`
20. **Name** the source of every number, person, company and quote on the surface. Expect a real
    supplied value for each, and 0 unsourced. `forge-ui-no-fabricated-data`
21. **Grep** `rg 'appearance-none|list-none|\bp-0\b|\bborder-0\b'` and, for each hit, name the
    replacement drawn in its place — a track and thumb, an arrow, a `Separator` or a deliberate
    gap, a size clearing the `Button` `sm` box, or a `border-*` token. Expect every hit paired with
    a named replacement, and 0 bare. `forge-ui-affordance-replacement`
22. **Count** utilities in a `class` prop on a forge component that the component's own classes
    already set. Expect 0; pass only the difference, which `cn` merges last and lets win.
    `forge-ui-class-no-restate`

---

## Block 2 — Defaults

Rebuttable only by a written brief. Where you depart, name the brief line beside the count.

### Hierarchy and component choice

23. **Count** primary buttons per surface — `primary` is `Button`'s default `tone`, so count both
    the buttons carrying `tone='primary'` and those carrying no `tone` at all:
    `rg -o "<Button[^>]*" | rg -v "tone='(neutral|secondary|destructive|info|success|warning)'" | wc -l`.
    Expect exactly 1.
    `forge-ui-hierarchy-one-primary`
24. **Count** `primary` buttons inside each `<form>`. Expect exactly 1, and expect it to be the
    submit. `forge-ui-form-one-primary`
25. **Count** `Alert`s and `Toast`s whose `tone` is not `neutral`, and name the specific failure,
    risk or completed action each claims. Expect a named claim per tone.
    `forge-ui-hierarchy-severity-default-first`
26. **Count** icon-only buttons whose `shape` is not `icon`, `square` or `circle`. Expect 0.
    `forge-ui-hierarchy-icon-button-size`
27. **Count** `Dialog`s and, for each, name what cannot proceed behind it. Expect 0 without an
    answer. `forge-ui-catalog-overlay-weight`
28. **Count** `Badge`s wired to a click handler or wrapped in a link. Expect 0.
    `forge-ui-catalog-wrong-badge`
29. **Count** `Card`s with no title, no description and no action. Expect 0.
    `forge-ui-catalog-container-card`

### Layout, spacing and density

30. **List** the distinct spacing steps used: `rg -o 'gap-[0-9.]+|p[xytblr]?-[0-9.]+' | sort -u`.
    Expect at most four, none within 25% of another. `forge-ui-layout-step-distance`
31. **Divide** the gap between groups by the gap within a group. Expect a ratio of at least 2.
    `forge-ui-layout-group-gap-ratio`
32. **Count** content columns with no `max-w-*` ceiling and `mx-auto`. Expect 0.
    `forge-ui-layout-measure-container`
33. **Grep** `rg 'border-b'` on list rows. Expect 0; a `Separator` between rows is the form.
    `forge-ui-layout-separator-over-border`
34. **Name** the density, variance and motion numbers you built at, and the signal in the brief you
    read them from. Expect one line, stated beside the Design Read.
    `forge-ui-density-infer-from-signal`
35. **Count** regions driven by unbounded data that are not the page's main column and not wrapped
    in `ScrollArea`. Expect 0. `forge-ui-layout-scroll-area-bound`
36. **Count** columns of numbers, then count those carrying `tabular-nums`. Expect equal.
    `forge-ui-density-tabular-numerals`
37. **Count** `Card`s rendered once per list row. Expect 0; rows separate with `Separator` inside one
    `Card.Content`. `forge-ui-density-separator-over-card`

### Type

38. **List** the type steps on the surface: `rg -o 'text-(xs|sm|base|lg|xl|[0-9]xl)' | sort -u`.
    Expect three or four, and expect 0 adjacent-step pairs. `forge-ui-type-scale-jump`
39. **Count** distinct font weights: `rg -o 'font-(normal|medium|semibold|bold)' | sort -u | wc -l`.
    Expect at most 2. `forge-ui-type-two-weights`
40. **Count** paragraphs set at `text-xs`. Expect 0. `forge-ui-type-min-body-size`
41. **List** every step above `text-3xl` with whatever precedes it: `rg -o '[a-z:]*text-[4-9]xl'`.
    Expect each hit to carry a breakpoint variant, and 0 bare — less any surface whose minimum
    width you can name. `forge-ui-type-scale-viewport-ratio`
42. **Grep** `rg 'tracking-'` on body copy. Expect 0 hits outside all-caps labels.
    `forge-ui-type-tracking-body`
43. **Count** label-shaped elements that are not `Label`, not `FormField.Label`, and do not apply
    `FIELD_LABEL_CLASSES` through `cn`. Expect 0. `forge-ui-type-label-class`

### Colour

44. **Grep** `rg 'bg-(gray|slate|zinc|stone|neutral|red|blue|emerald|yellow|amber)-[0-9]'` in
    application markup. Expect 0 hits. For a status surface the answer is a `--status-*` token —
    `bg-status-danger-subtle`, `bg-status-success-strong` — or the `Alert`, `Toast` or `Badge`
    tone that already carries one. For a hue no forge token covers, expect a light/`dark:` pair on
    every hit; a bare one survives the theme switch, which is the failure.
    `forge-ui-color-theme-no-raw-utility`
45. **Name** the measured ratio of `--muted-foreground` on `--muted`, for every theme the app ships,
    in both modes. Expect every ratio recorded, not assumed. `forge-ui-color-theme-muted-pair`
46. **If you authored a `--gray-*` scale**, name its measured pairs — `--foreground` on
    `--background`, `--muted-foreground` on `--muted`, `--card` against the page, `--input` and
    `--ring` against the surface behind them — in both modes. Expect every one recorded, and expect
    0 repaired by lowering the ramp's chroma. `forge-ui-color-ramp-author-audit-pairs`
47. **Count** opacity modifiers applied to a colour utility to fake an intermediate shade. Expect 0;
    move one stop along the ramp instead. `forge-ui-color-scale-no-adhoc-tint`

### Media

48. **Count** text elements rendered over a photograph, then count `absolute inset-0` scrims behind
    them. Expect equal — the ratio must be token against token before `forge-ui-contrast-floor` can
    be measured at all. `forge-ui-media-text-scrim`
49. **Grep** `rg '<img'` and, for each hit, name its `alt`. Expect 0 without one, and expect every
    empty `alt` paired with the surrounding text that carries the same meaning.
    `forge-ui-media-alt-required`
50. **Count** images whose proportions the surface does not control — uploads, avatars,
    third-party thumbnails — then count those inside an `aspect-*` container with `object-cover`
    and `overflow-hidden`. Expect equal. `forge-ui-media-fixed-crop`
51. **Name** the size class on every sprite glyph you rendered. Expect `size-4` or `size-5` on each,
    with any larger box carried by an enclosure around the glyph rather than by the glyph itself.
    `forge-ui-media-icon-intended-size`

### Depth

52. **Grep** `rg 'shadow-(sm|md|lg)'` and, for each hit, name the component it sits on. Expect 0 on a
    component that already renders a shadow. `forge-ui-depth-no-shadow-stack`
53. **Count** elevation changes along the deepest containment path. Expect at most 1 per step.
    `forge-ui-depth-one-step`

### Forms

54. **Count** submitted controls that can be rejected, then count those wrapped in `FormField` with
    a `FormField.Label` and a `FormField.Error`. Expect equal. `forge-ui-catalog-field-wrapper`
55. **Grep** `rg 'id="field|for="'` for hand-written field ids. Expect 0; ids come from `fieldId`,
    `fieldDescriptionId` and `fieldErrorId`. `forge-ui-form-id-helpers`
56. **Count** mutation `Form`s, then count `Honeypot` first children. Expect equal, and expect 0
    `Honeypot` on any `method="get"` form. `forge-ui-form-honeypot-placement`
57. **Count** fields that can be invalid, then count those carrying `data-invalid`, `aria-invalid`
    and an `Icon` together. Expect equal. `forge-ui-form-invalid-triple`
58. **Count** control names imported from both `@y-core/forge/ui/core` and
    `@y-core/forge/ui/controls` in one module without an alias. Expect 0. `forge-ui-form-one-barrel`

### States and swaps

59. **Count** the states you designed for the surface: empty, loading, error, success. Expect 4, or
    a named reason a state cannot occur. `forge-ui-state-four`
60. **Count** loading indicators per loading region. Expect exactly 1. `forge-ui-state-one-indicator`
61. **Count** `Spinner`s standing in a region whose result shape is already known. Expect 0.
    `forge-ui-state-skeleton-shape`
62. **Count** error states with no retry control beside the message. Expect 0, less any error that
    retrying cannot fix. `forge-ui-state-error-retry`
63. **Count** htmx swap targets with no placeholder in the initial page render. Expect 0.
    `forge-ui-htmx-reserve-space`
64. **Count** swap targets that contain the control which triggered the request. Expect 0 — that
    swap drops focus to `<body>`. `forge-ui-htmx-restore-focus`

### Interaction and announcement

65. **Count** live regions on the page. Expect exactly 1, the flash container.
    `forge-ui-a11y-one-live-region`
66. **Count** `data-*` state attributes you emit, then count their ARIA counterparts. Expect equal.
    `forge-ui-a11y-aria-beside-data`
67. **Grep** `rg 'focus:' | rg -v 'focus-visible:|focus-within:'`. Expect 0 hits.
    `forge-ui-interaction-focus-visible`
68. **Count** motion moments per interaction. Expect 1. `forge-ui-interaction-one-moment`
69. **Count** animated properties that are not `transform` or `opacity`. Expect 0, less a disclosure
    whose height change is the point. `forge-ui-interaction-no-motion-on-layout`

### Tells

70. **Grep** `rg 'bg-clip-text'`. Expect 0 hits. `forge-ui-tell-gradient-text`
71. **Grep** `rg 'backdrop-blur'`. Expect 0 hits on a surface in the page flow.
    `forge-ui-tell-glass-surface`
72. **Count** rows of exactly three equal cards, then count the items in the data behind them. Expect
    the two to match. `forge-ui-tell-three-card-row`
73. **Count** headings carrying an eyebrow line above them. Expect 0, or 1 that names a category the
    heading cannot. `forge-ui-tell-eyebrow-kicker`

### Platform

Seven of the forty rules in [`reference/16-platform.md`](./reference/16-platform.md) — the ones an
agent writes from muscle memory, and that one grep answers with a number. The rest of that file is
read when the task reaches it; these are checked on every surface. **Items 74–77 are stated flat and
no brief rebuts them**; 78–80 are Defaults like the rest of this block.

74. **Grep** `rg -o '\b(ml|mr|pl|pr)-[0-9.]+|border-[lr]\b|rounded-[lr]\b|text-(left|right)\b'`.
    Expect 0 hits; the logical spelling is `ms-`/`me-`, `ps-`/`pe-`, `border-s`/`border-e`,
    `rounded-s`/`rounded-e`, `text-start`/`text-end`. `forge-ui-platform-logical-spacing`
75. **Grep** `rg 'padding-bottom:\s*[0-9.]+%'`. Expect 0 hits; an `aspect-*` utility is the box.
    `forge-ui-platform-aspect-ratio`
76. **Grep** `rg -- '-translate-x-1/2|translate\(-50%'` and, for each hit, name the container that
    could have carried the centring instead. Expect 0 bare. `forge-ui-platform-centering`
77. **Grep** `rg '::-webkit-scrollbar'`. Expect 0 hits; `ScrollArea.Viewport`'s `scrollbar-width`
    and `scrollbar-color` pair is the form. `forge-ui-platform-scrollbar`
78. **Count** selectors declared a second time under `prefers-color-scheme`:
    `rg -c 'prefers-color-scheme'`. Expect 0; one `light-dark()` value holds both modes.
    `forge-ui-platform-light-dark`
79. **Grep** `rg 'role="(alert)?dialog"|aria-modal'` and, for each hit, name the element it sits on.
    Expect every hit on a `<dialog>`, and 0 on a `div`. `forge-ui-platform-native-dialog`
80. **Count** headings at `text-2xl` or larger, then count those carrying `text-balance`. Expect
    equal, less any heading that cannot wrap. `forge-ui-platform-text-balance`

---

## Reporting

**The output of this pass is the counts, not a claim of compliance.** Report the number each item
produced, beside the item's rule id. A report that says the surface passes, without the numbers that
say so, has not run the audit.

**An item you cannot answer with a number is a failed item, not a passed one.** "Looks fine",
"not applicable", and silence are all failures — the first two because they are judgements the
checklist exists to replace, and the third because an unrun item and a clean one are
indistinguishable in a report that omits both. Where an item genuinely cannot apply, say which item,
and say what makes it inapplicable; that sentence is the evidence, and it is reviewable.

A Block 1 failure blocks the work. A Block 2 failure is either repaired or reported with the brief
line that overrode it — and there is no third disposition, per `forge-ui-review-unattributed-finding`.
