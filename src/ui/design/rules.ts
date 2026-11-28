/** The design rules `src/ui/design/` argues, which `config/rules.config.ts` registers ahead of forge's own. */

import type { RuleEntry } from "../../../warden/src/rules/types";

/** Every `forge-ui-*` rule whose marker sits in the design corpus. */
export const UI_DESIGN_RULES: readonly RuleEntry[] = [
  {
    id: "forge-ui-catalog-action-pyramid",
    statement:
      'Default: one primary `Button` per surface, with every other action `appearance="outline"` or `appearance="ghost"`, unless a surface genuinely presents two equal terminal paths with no default, as an accept/decline pair does.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-destructive-confirm",
    statement:
      'Default: a destructive confirmation is a `Dialog` carrying an `Alert` `tone="destructive"` that names what is lost, with the confirm control labelled with the verb rather than "OK", unless the action is reversible from the same surface within the session — then perform it and report with a `Toast`, since a confirmation on an undoable action trains the user to dismiss confirmations.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-skeleton-over-spinner",
    statement:
      "Default: when the awaited content has a known shape, use `Skeleton` in that shape, unless the wait has no layout to preserve — a submit button in flight, a background job with no slot — where `Spinner` is correct and `Skeleton` would invent a shape.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-alert-vs-toast",
    statement:
      "Default: a condition the user must still act on is an `Alert` in the flow; a result of something already finished is a `Toast`, unless a persistent condition is genuinely global to the app rather than to a surface, and has nowhere in the flow to sit.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-overlay-weight",
    statement:
      "Default: pick the lightest overlay the job survives — `Collapsible` when the content belongs to the page, `Popover` when it is anchored to a trigger, `Dialog` only when the task truly blocks, unless the content must be read before anything else can proceed, or when losing it to a light dismiss would lose work.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-tabs-vs-accordion",
    statement:
      "Default: use `Tabs` for peer views of one subject and `Accordion` for independent sections the user may want open at once, unless the views are peers but their content is long enough that switching costs the reader their place — an `Accordion` lets them keep both.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-choice-count",
    statement:
      "Default: the number of options picks the control — two, use `Switch` or `Toggle`; three to five, use `RadioGroup` or `ToggleGroup`; more than five, use `Select`, unless the option set is long but the user knows the answer by name, where a `Select` beats any expanded set regardless of count.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-select-rows",
    statement:
      "Default: let `Select` collapse to a popup, and reach for its `rows` only when the options must all be visible at once, unless the choice is one of a short, stable set the user compares side by side — a filter panel, a column picker — where opening a popup to read four fixed options costs a click for nothing.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-field-wrapper",
    statement:
      "Default: wrap every validated input in `FormField` with `FormField.Label` and `FormField.Error`, unless it is a settings row with no validation and no error slot, which takes `Field`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-bound-controls",
    statement:
      "Default: import a control from `@y-core/forge/ui/core` when nothing binds it and from `@y-core/forge/ui/controls` when a `bind` target does, unless the module also imports that name bound and does not alias either import, where both uses come from `ui/controls` per `forge-ui-form-one-barrel`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-container-card",
    statement:
      "Default: use `Card` only when the group has its own title, description, or action, and otherwise group with spacing and a `Separator`, unless the surface's whole job is a grid of peer objects, where the border is what makes the boundaries scannable.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-scroll-area",
    statement:
      "Default: bound a list to a height with `ScrollArea` when the surrounding layout must stay fixed, unless the page itself is the scroll container, where a nested scroll region traps the wheel and hides content below the fold.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-wrong-spinner",
    statement:
      "Default: a slot whose shape is known waits on a `Skeleton` matching that shape, not a `Spinner`, unless the wait is very short, where a skeleton flash is more disruptive than a small spinner.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-wrong-dialog",
    statement:
      "Default: a small anchored form or an optional detail that blocks nothing takes a `Popover`, or a `Collapsible` when it belongs to the page, not a `Dialog`, unless the content must be read before anything else can proceed, or losing it to a light dismiss would lose work.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-wrong-alert",
    statement:
      "Default: the outcome of an action just completed is a `Toast`, not an `Alert`, unless the result changes what the surface _is_ — a subscription that just ended — where a persistent `Alert` is the honest rendering.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-wrong-toast",
    statement:
      "Default: a condition that is still true and that the user must act on is an `Alert` in the flow, not a `Toast`, unless the condition is genuinely global to the app rather than to a surface, and has nowhere in the flow to sit.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-wrong-badge",
    statement:
      'Default: a clickable label is a `Button` `tone="neutral" appearance="ghost" size="sm"`, never a `Badge` wired to click, unless clicking it presses a mode or narrows a set, which makes it a `Toggle` or a `Filter` chip rather than a `Button`.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-wrong-tooltip",
    statement:
      "Default: text the user must read goes in `FormField.Description` or visible copy, not a `Tooltip`, unless it is too long to sit beside its control, where a `Popover` the reader opens on purpose holds it.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-wrong-progress",
    statement:
      "Default: a value in a fixed range is a `Meter`, not a `Progress`, unless the value is how much of a task has finished toward a known total, which is the claim `Progress` makes.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-catalog-wrong-raw-input",
    statement:
      "Never render a raw `<input>`, `<select>`, `<textarea>` or `<button>` where the `ui/core` control exists, and reach for `Input`, `Select`, `Textarea` or `Button` instead, inside `FormField` when the value is validated.",
    detectors: [{ kind: "lint", key: "forge/catalog-wrong-raw-input" }],
  },
  {
    id: "forge-ui-catalog-wrong-unbound-input",
    statement: "Bind a signal-bound control through the `ui/controls` `Input`, never the `ui/core` `Input`, which has no `bind` prop.",
    detectors: [{ kind: "review" }],
  },
  { id: "forge-ui-design-read", statement: "Emit the Design Read before you build.", detectors: [{ kind: "review" }] },
  { id: "forge-ui-measure-cap", statement: "Cap body copy at a comfortable measure — 45–75 characters.", detectors: [{ kind: "review" }] },
  {
    id: "forge-ui-contrast-floor",
    statement: "Meet 4.5:1 for body text and 3:1 for large text and UI boundaries, in both `:root` and `.dark`.",
    detectors: [
      { kind: "step", label: "validate-contrast" },
      { kind: "step", label: "validate-faded-text" },
    ],
  },
  { id: "forge-ui-not-color-alone", statement: "Never carry status by color alone.", detectors: [{ kind: "review" }] },
  {
    id: "forge-ui-focus-ring",
    statement: "Keep focus visible on every interactive element.",
    detectors: [{ kind: "lint", key: "forge/focus-ring" }],
  },
  { id: "forge-ui-affordance-replacement", statement: "Replace every affordance you suppress.", detectors: [{ kind: "review" }] },
  {
    id: "forge-ui-hit-target",
    statement: "Keep every interactive target at or above an absolute 28px (`1.75rem`, `h-7`) on both axes.",
    detectors: [{ kind: "test", path: "src/ui/hit-target.browser.ts" }],
  },
  {
    id: "forge-ui-reduced-motion",
    statement:
      "Honour `prefers-reduced-motion` on every authored motion, by removing the motion or by replacing a scale or slide with an opacity fade.",
    detectors: [{ kind: "lint", key: "forge/reduced-motion" }],
  },
  { id: "forge-ui-empty-state", statement: "Ship a designed empty state on every collection surface.", detectors: [{ kind: "review" }] },
  { id: "forge-ui-accessible-name", statement: "Give every control an accessible name.", detectors: [{ kind: "review" }] },
  {
    id: "forge-ui-a11y-label-association",
    statement: "Associate every `<label>` with its control.",
    detectors: [{ kind: "lint", key: "forge/a11y-label-association" }],
  },
  { id: "forge-ui-heading-order", statement: "Never skip a heading level.", detectors: [{ kind: "review" }] },
  {
    id: "forge-ui-color-token-only",
    statement: "Never write a raw color literal in a `class`.",
    detectors: [{ kind: "lint", key: "forge/color-token-only" }],
  },
  { id: "forge-ui-no-inline-style", statement: "Never write a `style=` attribute.", detectors: [{ kind: "lint", key: "forge/no-inline-style" }] },
  {
    id: "forge-ui-class-no-restate",
    statement: "Never restate a component's own base classes to change one of them.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-spacing-scale-only",
    statement: "Use Tailwind's default spacing scale.",
    detectors: [{ kind: "lint", key: "forge/spacing-scale-only" }],
  },
  {
    id: "forge-ui-no-nested-card",
    statement: "Never nest a `Card` inside `Card.Content`.",
    detectors: [{ kind: "lint", key: "forge/no-nested-card" }],
  },
  {
    id: "forge-ui-foreground-pairing",
    statement: "Use every background token with its paired foreground token, such as `bg-card` with `text-card-foreground`.",
    detectors: [{ kind: "review" }],
  },
  { id: "forge-ui-text-color-budget", statement: "Hold a surface to two text colors.", detectors: [{ kind: "review" }] },
  { id: "forge-ui-one-radius", statement: "Keep one radius.", detectors: [{ kind: "review" }] },
  { id: "forge-ui-real-icons", statement: "Take icons from the sprite.", detectors: [{ kind: "review" }] },
  { id: "forge-ui-no-fabricated-data", statement: "Never invent data.", detectors: [{ kind: "review" }] },
  {
    id: "forge-ui-hierarchy-one-primary",
    statement:
      "Default: exactly one primary button renders per surface — a page, a `Dialog`, or a `Card` each count as one surface — unless a written brief describes a surface with two genuinely co-equal outcomes, such as an accept/decline decision with no default.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-hierarchy-secondary-alternative",
    statement:
      "Default: the outline button is reserved for the action a user would plausibly take _instead_ of the primary one, not for the second-most-visible thing on the surface, unless a brief calls for a paired control set where both members carry equal commitment.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-hierarchy-ghost-remainder",
    statement:
      "Default: every remaining action uses `appearance='ghost'`, including cancel and dismiss, unless the action is the sole control on an otherwise empty surface and would read as decoration without a border.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-hierarchy-deemphasize-first",
    statement:
      "Default: when an element does not read as prominent enough, lower the weight of its neighbours before raising its own — reach for `appearance='ghost'` over `appearance='outline'`, and a `Badge` with `appearance='outline'` over a filled one — unless a brief sets Variance above forge's ratified default.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-hierarchy-badge-outline-first",
    statement:
      "Default: a `Badge` used as a neutral label rather than a status signal uses `appearance='outline'`, unless the badge is the only element distinguishing two otherwise identical rows.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-hierarchy-icon-button-size",
    statement:
      "Default: an icon-only `Button` uses `shape='icon'` and never a text size with a hand-tuned padding override, unless the button sits in a container whose width is set by the app, in which case `shape='square'` is the correct choice.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-hierarchy-square-needs-width",
    statement:
      "Default: `shape='square'` is used only where the parent supplies a definite width, unless a brief specifies a fluid grid of equal cells.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-hierarchy-severity-default-first",
    statement:
      "Default: an `Alert` or `Toast` uses `tone='neutral'` unless the message names a specific failure, a specific risk, or a completed action whose result the user cannot otherwise see.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-hierarchy-destructive-reserve",
    statement:
      "Default: `tone='destructive'` is reserved for loss and failure, never for a confirmation prompt or a field-level validation message, unless a brief defines a domain where the two are the same event.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-hierarchy-label-last-resort",
    statement:
      "Default: a value that is unambiguous in context renders without a label, unless the value appears in a form the user will submit, where a `Label` is required by `forge-ui-accessible-name`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-hierarchy-hidden-section-title",
    statement:
      "Default: a section whose purpose is obvious from its layout carries a visually hidden heading rather than a visible one, unless the section is one of several that a user must choose between by name.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-hierarchy-card-action-placement",
    statement:
      "Default: a `Card`'s single most important action renders in `Card.Footer`, and a surface-level control that acts on the card as a whole renders in `Card.Action`, unless the card is itself a link target, in which case it carries no button at all.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-layout-scale-step",
    statement:
      "Default: a surface draws its spacing from a small set of steps chosen up front — `2`, `3`, `4`, `6`, `8`, `12`, `16` is a workable default set — rather than picking a fresh value at each decision, unless a brief specifies a density other than forge's ratified default.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-layout-step-distance",
    statement:
      "Default: no two spacing values on one surface sit within 25% of each other — `gap-5` beside `gap-6` reads as a mistake rather than a distinction, while `gap-4` beside `gap-6` reads as deliberate — unless the two values are set by two different forge primitives whose internals the surface does not control.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-layout-group-gap-ratio",
    statement:
      "Default: the gap separating two groups is at least twice the gap separating members within a group, unless a `Separator` or a background change is already carrying the boundary.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-layout-field-gap-ladder",
    statement:
      "Default: `FormField.Group` and `FormField.Content` keep their built-in gaps, unless a brief sets a density that requires the whole form to move together — in which case both move, and the ratio between them is preserved.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-layout-card-section-rhythm",
    statement:
      "Default: content inside a `Card` uses the section components rather than padding the root directly, so the section rhythm survives, unless the card holds a single edge-to-edge element such as an image or a table that should bleed to the border.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-layout-gap-over-margin",
    statement:
      "Default: spacing between siblings is expressed with a `gap-` utility on the flex or grid parent rather than margins on the children, unless one child needs a distance the others do not.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-layout-stack-depth",
    statement:
      "Default: a `Stack` shows at most three layers and only the top one is read; a pile deeper than that is a count (`Badge` in an `Indicator`) or a list, never a taller fan, unless a brief raises the variance dial for a marketing surface and the pile is decoration no reader opens.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-layout-measure-container",
    statement:
      "Default: a content column carries a `max-w-` ceiling and centres with `mx-auto`, unless the region is a table, a canvas, or a media element whose value comes from filling the space.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-table-not-list",
    statement:
      "Default: tabular data with two or more comparable columns per record uses `Table`, and a single-value-per-record sequence uses a list, unless the columns exist only to align a label against its value — a definition list or a `Field` layout carries that better.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-layout-border-budget",
    statement:
      "Default: grouping is expressed by spacing first, by a `--muted` background or a `Separator` second, and by a `Card`'s border last, unless a brief describes a surface of peer objects — a dashboard of independent panels — where the card border is what makes them countable.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-layout-separator-over-border",
    statement:
      "Default: a divider between rows of one list uses `Separator` rather than a `border-b` utility on each row, unless the rows are already interactive and need a hover background that a `<hr>` would interrupt.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-layout-muted-panel",
    statement:
      "Default: a panel that needs to read as recessed rather than raised uses a `--muted` background with no border, unless it sits directly on a `--muted` surface already, where the two would merge.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-layout-scroll-area-bound",
    statement:
      "Default: a region whose height is driven by unbounded data and is not the page's main column is wrapped in `ScrollArea` with an explicit height, unless the region is the page's primary content, where the document scroll is the correct scroll.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-type-scale-jump",
    statement:
      "Default: a surface uses three or four sizes with real distance between them — `text-sm`, `text-base`, `text-2xl` is a workable set — rather than walking consecutive steps of the scale, unless a brief calls for a dense data view where `text-xs` and `text-sm` must coexist as row text and column headers.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-type-min-body-size",
    statement:
      "Default: body copy is never smaller than `text-sm`, and `text-xs` is reserved for labels, badges, and metadata — where forge already puts it, in `Field`'s label span and in `Badge` — unless a brief specifies a dense view and the text is not the primary content.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-type-scale-viewport-ratio",
    statement:
      "Default: a step above `text-3xl` is written as the smaller step with the large one raised at a breakpoint — `text-3xl md:text-5xl` — so the headline is sized for the narrow viewport and grows, unless the surface states a minimum width it will never render below, such as an embedded view whose host fixes its frame.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-type-two-weights",
    statement:
      "Default: a surface uses at most two font weights — a normal weight for body copy and one heavier weight for emphasis — unless a brief specifies a display face with its own weight range.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-type-weight-over-size",
    statement:
      "Default: emphasis within body copy is achieved by raising weight or changing to `--muted-foreground`, never by increasing size, unless the emphasised text is a heading that outranks the surrounding copy.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-type-measure-target",
    statement:
      "Default: a body-copy column targets a line length of 45–75 characters — `max-w-prose` lands inside that band at the default font size — unless the region is a table or a code block, where wrapping costs more than the long line does.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-type-leading-inverse",
    statement:
      "Default: leading tightens as size increases and loosens as size decreases, following the leading table in this section, unless the text sits in a fixed-height row where the line box must match a control's height.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-type-tracking-large",
    statement:
      "Default: text at `text-2xl` and above carries `tracking-tight`, as `Alert.Title` does, unless the text is set in a face whose large sizes are already tightly spaced.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-type-tracking-body",
    statement:
      "Default: body copy carries no tracking utility at all, unless it is a short all-caps label, where `tracking-wide` compensates for uniform letterform width.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-type-tabular-numerals",
    statement:
      "Default: any number that changes in place — a live count, a timer, a `Progress` or `Meter` readout — or that appears in a column beside other numbers is set with `tabular-nums`, unless the number appears exactly once as inline prose.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-type-label-class",
    statement:
      "Default: a form label renders through `Label` or `FormField.Label`, and any bespoke label-shaped element applies `FIELD_LABEL_CLASSES` through `cn` rather than restating its classes, unless the element is a decorative caption with no control to name — the case `Field`'s own label span already covers.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-scale-override-step",
    statement:
      "Default: a per-mode value is overridden on the step, never on the semantic token — an app that wants a different muted foreground in dark mode re-declares `--gray-11` with a `light-dark()` rather than `--muted-foreground` — unless the value is meant to be the same in both modes, which is the semantic token's own job.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-ramp-author-lightness",
    statement:
      "Default: a scale is authored in a colour space that carries lightness as its own coordinate — `oklch()`, the form `src/ui/README.md` writes it in — so that a step can be moved lighter or darker without dragging its hue and its chroma along, unless the scale inherits its lightness from an existing ramp that already holds balanced steps, which is what every shipped scheme does.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-ramp-author-endpoint-tint",
    statement:
      "Default: steps 1, 2, 11 and 12 keep a visible amount of the brand hue rather than resolving to white and black, because those four are exactly where `theme-base.css` puts the page ground, the raised surface and the default text in the two modes, unless a brief pins a neutral page and confines the brand hue to `--primary` — the per-token override `src/ui/README.md` documents.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-ramp-author-tinted-neutrals",
    statement:
      "Default: the tint runs through the whole scale, not only its ends, with the middle steps carrying the same hue at a chroma low enough to read as neutral, unless a brief fixes untinted greys.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-ramp-author-audit-pairs",
    statement:
      "Default: a newly authored scale is measured on the pairs `theme-base.css` actually consumes — `--foreground` on `--background`, `--muted-foreground` on `--muted`, `--card` against the page, `--input` and `--ring` against the surface behind them — in both `:root` and `.dark`, unless the new scale only rotates the tint of an already-audited one at identical lightness, which is the carve-out `forge-ui-color-theme-per-theme-audit` already states.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-scale-ramp-only",
    statement:
      "Default: a shade comes from a declared step of the scale, or from a semantic token built on one, and is never generated on the fly — no `color-mix` against an arbitrary percentage, no one-off opacity faking an intermediate grey — unless a brief introduces a brand hue, which is then declared as steps in a theme file like every other.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-scale-adjacent-stops",
    statement:
      "Default: two adjacent steps are not used together as a foreground/background pair — `--gray-9` on `--gray-10` is a contrast failure before it is an aesthetic one — unless the pair is a _decorative_ boundary against its own surface, where low contrast is the point.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-scale-no-adhoc-tint",
    statement:
      'Default: a surface that needs "slightly lighter" or "slightly darker" moves one step along the scale rather than applying an opacity modifier to the current colour, unless the element is genuinely translucent over content it must not hide — a scrim or an overlay, which is what `--overlay` and the absolute `--black-a1` … `--black-a12` and `--white-a1` … `--white-a12` ramps are for.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-semantic-accent-interactive",
    statement:
      "Default: interactive feedback — hover, open, selected — is expressed with `--accent` and its paired foreground, as `buttonVariants` does for `secondary` and `ghost`, unless the element's resting state is already `--accent`, in which case it moves to `--primary`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-semantic-pairing",
    statement:
      "Default: a background token is set together with its paired foreground token and never with a foreground from a different pair, unless the element inherits a foreground from a parent that has already set the matching one.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-semantic-support-only",
    statement:
      'Default: every state distinguished by colour is also distinguished by a word, an icon, or a position — a `Badge` says "Failed" as well as being red, an `Alert` carries an `Alert.Title` — as required by the Floor rule `forge-ui-not-color-alone`, unless the colour is decorative and encodes no state at all.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-theme-no-raw-utility",
    statement:
      "Default: a colour reaches the page through a semantic token, including the `--status-` family for the status intents, and a scale step is named directly only inside `theme-base.css` or a theme file, unless the colour is a fixed hue no forge token covers, in which case the utility carries its own `dark:` counterpart.",
    detectors: [{ kind: "lint", key: "forge/color-theme-no-raw-utility" }],
  },
  {
    id: "forge-ui-color-theme-both-modes",
    statement:
      "Default: a foreground/background pair is verified in both `:root` and `.dark`, for every scheme the application ships, unless the application loads exactly one theme file and locks the mode.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-theme-muted-pair",
    statement:
      "Default: `--muted-foreground` on `--muted` is audited explicitly for every scheme, because it is the pair with the least headroom in the system — light mode puts `#646464` on `#f0f0f0` and dark mode `#b4b4b4` on `#222222`, through `--gray-11` on `--gray-3` — and a failure is repaired in the theme file rather than worked around at the call site, unless a brief pins the scheme's steps as fixed brand values, in which case the repair moves to what `--gray-11` is worth in the failing mode.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-theme-per-theme-audit",
    statement:
      "Default: adding a theme file includes an audit of its steps against the semantic mapping in `theme-base.css` rather than an assumption that the mapping transfers, unless the new file changes only the tint of an already-audited scale at identical lightness.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-semantic-destructive-pair",
    statement:
      "Set `bg-destructive` together with `text-destructive-foreground`, never with a foreground picked by hand, and colour destructive text with `text-destructive-text` rather than the fill.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-color-semantic-variant-fixed",
    statement:
      "Default: a status surface is expressed with the `--status-` token for its intent and tier, or by consuming the `Alert`, `Toast` or `Badge` tone that already does, and never with a fixed palette utility, unless a brief calls for a signal hue outside forge's four intents, in which case it is declared as a token pair in a theme file, or written as a light utility with its own `dark:` counterpart.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tone-by-intent",
    statement:
      "Default: pick `tone` from what the message is — `destructive` for loss or an irreversible act, `warning` for a risk the reader can still avoid, `success` for a claim that something completed, `info` for neutral information, `primary` for the one primary action a surface has, and `neutral` for everything else — unless a brief gives a tone its own meaning, which is then applied everywhere that meaning appears.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-soft-vs-solid",
    statement:
      "Default: `soft` is the resting emphasis for `Alert`, `Badge` and `Toast`, and `solid` is reserved for the one surface that must lead the page, never two solid panels in view at once — unless the component is `Button`, whose resting appearance is its own fill.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-depth-primitive-first",
    statement:
      "Default: express elevation by picking the primitive that already sits at that level, not by adding a shadow utility to a lower one, unless a surface genuinely has no matching primitive — a drag preview, a sticky column header — in which case take the shadow class from the level it is claiming, unchanged.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-depth-earn-raise",
    statement:
      "Default: a surface is raised only when it is genuinely closer to the user, unless a brief asks for a marketing surface, where a raised card is doing attention work rather than distance work.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-depth-flat-body",
    statement:
      "Default: keep page body content at level 0, unless the body is a canvas of peer objects — a board of records — where each object is a `Card` and the page behind them stays flat.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-depth-dialog-last",
    statement:
      "Default: reserve `Dialog` for work that must not proceed in the background, unless the platform's focus trap is the point — a flow that is genuinely modal, such as re-authentication.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-depth-separator-order",
    statement:
      "Default: try spacing, then a background token, then a hairline, before a shadow, unless the two regions scroll independently, where a shadow is the only cue that survives the scroll.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-depth-popover-token",
    statement:
      "Default: a raised panel takes `bg-popover` with `text-popover-foreground`, unless a brief themes overlays separately, which changes the token and never the pairing.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-depth-soft-shadow",
    statement:
      "Default: every shadow is blurred and offset on the block axis only, unless a brief calls for a deliberately flat, illustrative style applied consistently rather than to one element.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-depth-no-shadow-stack",
    statement:
      "Default: never add a shadow class to a component that already renders one, unless the card genuinely is lifted — a drag-in-progress state — and then only for the duration of the lift.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-depth-one-step",
    statement:
      "Default: at most one elevation change per containment step, unless a genuinely layered tool UI — a canvas with a floating rail and a flyout off it — requires the third step, which `Toolbar`'s flyout already models.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-depth-radius-tracks-level",
    statement:
      "Default: let the radius step follow the elevation step rather than the element's size, unless a brief sets a flat or fully-pill radius, which moves `--radius` once rather than per component.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-formfield-default",
    statement:
      "Default: reach for `FormField` whenever the value is submitted and can be rejected, unless the control's value is applied immediately and cannot fail, such as a theme preference or a viewport slider.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-bare-label",
    statement:
      "Default: reach for `Label` only when you are placing the label yourself and own the control's id, unless the markup is not shaped by forge at all and has no row and no fieldset to put the label in.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-group-primitive",
    statement:
      "Default: use `CheckboxGroup` or `RadioGroup` rather than a `FormField` wrapping loose inputs, unless the items are not a single question, such as a matrix of independent toggles, which is a stack of `Field` rows.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-legend-variant",
    statement:
      'Default: `FormField.Legend` takes `as="legend"` when it heads a section of fields and `as="label"` when it names one cluster, unless a brief restates the form\'s type scale.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-otp-one-field",
    statement: 'Take a one-time code in one `<input autocomplete="one-time-code">`, never in N inputs with a focus-advance script.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-toggle-by-submission",
    statement: "Pick a two-state control by what its value means, never by which one looks right.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-filter-when",
    statement:
      'Default: `Filter` is for one-of-N facet narrowing where the chosen facet must stay visible and clearable; a set the reader may combine is `ToggleGroup type="multiple"`, and a choice that changes the form\'s meaning is `RadioGroup` with its label and error slots, unless the facets number more than five, where a `Select` narrows them per `forge-ui-catalog-choice-count`.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-id-helpers",
    statement:
      "Default: derive every field id through the helpers, never as a string literal, unless forge does not own the id, such as a `Dialog`'s `id`, where there is no helper to disagree with.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-control-props",
    statement:
      "Default: wire a control by passing it a `field` descriptor rather than by spreading attributes, unless composing a control forge does not ship, in which case call `fieldControlProps` yourself.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-label-classes",
    statement:
      "Default: when building a label-alike that is not a `<label>`, style it with `FIELD_LABEL_CLASSES`, unless it heads a group of fields rather than one, where it is a section heading and takes the `legend` variant per `forge-ui-form-legend-variant`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-scope-collision",
    statement:
      "Default: pass a `scope` whenever two fields on one page share a `name`, unless the page provably renders one such field, which is the common case and why `scope` is opt-in.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-bind-when-client",
    statement:
      "Default: reach for the `ui/core` base until a client signal actually reads the value, unless the surface is a `Resumable` island whose state drives other rendering.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-one-barrel",
    statement:
      "Default: one module imports a given control name from exactly one of `ui/core` and `ui/controls`, unless it aliases the second import explicitly.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-bind-and-field",
    statement:
      "Default: `bind` and `field` coexist on a control rather than compete, unless the bound control sits in no `FormField` and names itself, as a bound `Switch` with an `aria-label` in a toolbar does, where `field` has no label to wire.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-error-inline",
    statement: "Render a field's error message inside its own `FormField`, adjacent to the control, and never let a summary replace it.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-error-summary",
    statement:
      "Default: a top-of-form summary appears only in addition to the inline messages, and only when more than one field failed, unless the failure is not attributable to a field at all — a declined payment, a rate limit — where the `Alert` is the only correct home.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-validate-timing",
    statement:
      "Default: validate on submit first, then on change for the fields that failed, unless a field's validity is expensive to discover late, such as a username uniqueness check, which may validate on blur once a value exists.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-invalid-triple",
    statement: "Mark an invalid field with `data-invalid`, `aria-invalid` and an `Icon` together.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-turnstile-placement",
    statement:
      "Default: `Turnstile` sits inside the `<form>`, immediately above the submit control, unless the form is long enough that the widget would be off-screen at submit time, in which case place it in view of the button.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-one-primary",
    statement:
      "Default: one `primary` `Button` per form, and it is the submit, unless a brief calls for a split primary action whose two parts are visually one control.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-form-mark-smaller-set",
    statement:
      "Default: mark the smaller of the required and the optional fields, unless a brief carries a compliance requirement to mark every required field.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-four",
    statement: "Default: design the success, loading, empty and error states before shipping the surface, unless it has no data and no mutation.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-skeleton-shape",
    statement:
      "Default: a region whose result shape is known renders `Skeleton` blocks in that shape, unless the region may resolve to an empty state, and a skeleton would promise rows that never arrive.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-spinner-scope",
    statement:
      "Default: a `Spinner` marks a wait inside a control or a wait of unknown shape, never a region whose layout you can already draw, unless the wait in a known-shape region is very short, where a skeleton flash is more disruptive than a small spinner.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-preserve-layout",
    statement: "Default: the placeholder occupies the same box the result will, unless the result's height is genuinely unbounded.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-one-indicator",
    statement: "Default: one loading indicator per loading region, unless two genuinely independent requests are in flight in two regions.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-submit-spinner",
    statement:
      "Default: a submitting control keeps its label and gains a `Spinner`, rather than swapping the label out, unless the control is icon-only, where the spinner replaces the glyph in the same box.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-busy-vs-indicator",
    statement:
      "Default: `busy` — and `Button`'s `loading`, which sets it — marks a submission the server already knows about and stamped into the response it sent; a wait driven by the request lifecycle is `htmx-indicator`'s instead, per `11-htmx.md`, and no one control carries both — unless the wait is neither, where a `Spinner` beside the control is the whole answer.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-empty-composed",
    statement:
      "Default: an empty state is an `Alert` (or a `Card.Content` paragraph) plus one `Button` performing the action the user came for, unless the surface has no user-initiated way to fill it — a log stream — where the sentence stands alone and says why.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-hide-empty-controls",
    statement:
      "Default: hide the controls that operate on nothing, unless the filter is what _caused_ the emptiness, in which case keep it and add a control that clears it.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-error-inline",
    statement:
      "Default: a failure that belongs to a visible surface renders an `Alert` `tone='destructive'` in place, and the surface keeps its content, unless the content is known stale and showing it would mislead.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-error-toast",
    statement:
      "Default: a failure of work the user has navigated away from renders a `Toast` `tone='destructive'`, unless the failure blocks the next step, which is a `Dialog` or an in-place `Alert`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-error-retry",
    statement:
      "Default: every error state carries the retry, next to the message, unless retrying cannot help — a validation failure, a permission denial — where the correct control is the one that fixes the cause.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-success-toast",
    statement:
      "Default: a completed mutation is confirmed by a `Toast` `success`, not by an `Alert`, unless the result changes what the surface _is_ — a subscription that just ended — where a persistent `Alert` is the honest rendering.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-flash-redirect",
    statement:
      "Default: a confirmation that must survive a redirect goes through the flash primitives, unless the mutation returns a fragment to the same page, where a `Toast` rendered directly is simpler.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-state-success-specific",
    statement:
      "Default: a success message names what happened, not that something happened, unless it reports a bulk operation, where the count is the message.",
    detectors: [{ kind: "review" }],
  },
  { id: "forge-ui-state-progress-determinate", statement: "Render `Progress` only when the total is known.", detectors: [{ kind: "review" }] },
  {
    id: "forge-ui-state-meter-composed",
    statement:
      "Default: a measured value uses the `Meter` compound in full — `Meter.Label`, `Meter.Value`, `Meter.Track`, unless the value has no range to sit in, which makes it a number, not a meter.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-one-primary",
    statement:
      "Default: one `Navbar` per application, and it holds destinations only, unless a documented second axis, such as a persistent product switcher or a page-scoped table of contents, needs its own bar.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-config-driven",
    statement:
      "Default: build a bar of destinations from a `NavDefinition` rather than hand-writing links into a `<nav>`, unless it is a page-level sub-nav that is genuinely not the primary bar, which is ordinary markup.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-section-count",
    statement: "Default: a bar holds two or three `NavSection`s, unless a brief calls for a dense application bar with a declared zone model.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-menu-depth",
    statement: "Default: `NavMenu` nests one level, unless the application is reference-style and its navigation is genuinely a tree.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-group-over-menu",
    statement:
      "Default: when the destinations under a heading should be scannable, reach for `NavGroup`, not `NavMenu`, unless the bar is horizontal and short on room — which is where a `NavMenu` earns its click — or when the group is long enough that showing it would push the rest of the bar off screen.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-megamenu-when",
    statement:
      "Default: grouped children earn a megamenu only when a section has three or more groups the reader scans side by side, one group is a `NavMenu`, and a bar holds at most one megamenu, unless the groups are too many to scan side by side at the panel's width, where the section belongs in a left rail of `NavGroup`s.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-slot-not-link",
    statement:
      "Default: identity, theme and search go in a `NavSlot`, never a `NavLink`, unless the item is a plain link to a page of its own, as a signed-out sign-in link is, which is a destination and a `NavLink`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-placement-top",
    statement:
      'Default: leave `placement` unset and let the collapse mode pick it, `"top"` for the ordinary bar, unless the bar is deliberately a bottom bar or a side rail, such as the left rail an application with more than roughly seven primary destinations takes.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-rail-collapsible",
    statement:
      'Default: a `collapsible="always"` bar is a left rail and needs no `placement` to say so, unless it is a trailing-edge rail, which takes `placement="right"`, or the rare bar that stays collapsed at every width, which takes a horizontal placement.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-rail-flex-item",
    statement:
      "Default: the rail's width and `shrink-0` go on the flex item, which is the `Resumable` scope root, unless the rail's parent is not a flex row: a grid parent sizes the track, and the width belongs to the track definition rather than to either box.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-rail-persists",
    statement:
      "Default: a vertical rail stays pinned to the viewport and scrolls its own overflow, unless it is a short rail on a short page, where scrolling away with the content costs the reader nothing.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-rail-collapsed-width",
    statement:
      "Default: collapsed, the rail is one button wide, `w-14` or 56px, with the toggle at the leading edge, and open it is 16rem with the toggle trailing, unless a brief calls for a collapsed state that shows glyphs with labels, which needs more than one button of width.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-drawer-when",
    statement:
      'Default: a bar whose panel would displace the page on a phone takes `collapsedAs="drawer"`, unless the panel holds only a few links, which take `inline`.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-drawer-edge",
    statement:
      "Default: the drawer's edge is derived from `placement`, unless an app's own drawer already holds a top bar's leading edge, which then sets `drawerEdge`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-drawer-glyphs",
    statement: "Give a rail that opens off-canvas the `panel-open` and `panel-close` glyphs, and a top bar its hamburger.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-drawer-dismiss",
    statement: "Make a drawer dismissable four ways, by the toggle, the backdrop, Escape, and a link inside it.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-drawer-containing-block",
    statement: "Default: no ancestor of the bar carries `backdrop-filter`, `filter` or `transform`, unless the bar's panel stays `inline`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-user-labels",
    statement:
      "Default: name a destination for what the user wants there, not for the system that serves it, unless the system's own term _is_ the user's term — a developer console, where \"Workers\" is what the user came for.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-text-labels",
    statement:
      "Default: every `NavLink` carries visible text, unless it sits in a `Toolbar` rail, whose items are icon-only by design and carry `label` instead.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-current-location",
    statement:
      "Default: the current destination is indicated on every page, by `aria-current` plus a visible cue, unless the surface has exactly one destination.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-current-in-page",
    statement:
      'Mark a fragment link `aria-current="location"` and a link that changes the page `aria-current="page"`, deciding by whether a request was made rather than by whether the control looks like navigation.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-dock-when",
    statement:
      "Default: reach for `Dock` only when every destination is a top-level one and there are at most five; a sixth belongs behind the `Navbar`'s menu, and a bar that must also hold a user slot or a search box is a bottom-placed `Navbar`, unless the sixth is used as often as the five, where a bottom-placed `Navbar` shows all six rather than hiding one.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-toolbar-verbs",
    statement:
      "Default: `Toolbar` holds verbs that act on the object currently open, and `Navbar` holds destinations, unless the destination is another view of that same object, such as its history or its preview, which the reader opens as an act on it.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-toolbar-groups",
    statement:
      "Default: express grouping with `ToolbarGroup`, not with an explicit `ToolbarSeparator` between every item, unless a single group needs one internal break, which is what the explicit shape is for.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-toolbar-popover",
    statement:
      "Default: an infrequent or multi-part action is a `ToolbarPopover`, not another `ToolbarAction`, unless every item of the rail is a peer tool, such as a drawing palette.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-pagination-vs-scroll",
    statement:
      "Default: page a long list with `Pagination`, never with infinite scroll, unless the list is a feed with no stable ordering, where there is no position to return to.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-tabs-loaded",
    statement:
      'Default: use `Tabs` only when every panel\'s content is already on the page, unless a panel is expensive enough that arrow-key traversal would fire several loads, which takes `activation="manual"`.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-tabs-not-router",
    statement:
      "Default: a view with its own URL is a link, not a tab, unless the URL is only a fragment of the page already loaded, which `Tabs` follows without script.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-tabs-empty",
    statement:
      "Default: hide a `Tabs` whose panels are all empty, unless a filter emptied them, in which case keep it and add a control that clears the filter, as `forge-ui-state-hide-empty-controls` does.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-fouc-script",
    statement:
      "Default: embed `FOUC_SCRIPT` in an inline `<script>` in the `<head>`, and list its hash in the CSP `script-src`, unless the app renders one theme only and ships no `ThemeToggle`, where there is no stored preference to paint first.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-theme-constants",
    statement: "Read the theme constants, never restate their string values.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-nav-theme-toggle-placement",
    statement:
      "Default: `ThemeToggle` lives in the chrome, as a `NavSlot`, not on a settings page, unless the app already has a preferences surface the user visits, in which case the toggle may appear in both.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-ring-token",
    statement:
      "Default: draw focus with `focus-visible:ring-2 focus-visible:ring-ring`, and reach for no other treatment — unless a brief specifies a distinct focus style for a named surface.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-focus-visible",
    statement:
      "Default: use the `focus-visible` variant, never bare `focus` — unless the control is reachable _only_ by pointer, which in practice never happens.",
    detectors: [
      { kind: "lint", key: "forge/interaction-focus-visible" },
      { kind: "step", label: "validate-modern-css" },
    ],
  },
  {
    id: "forge-ui-interaction-size-from-button",
    statement:
      "Default: fix an undersized target by moving up the `buttonVariants` size scale, never by adding padding to a smaller one — unless the control is not a button at all and the brief names its box.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-adopt-composite",
    statement:
      "Default: give a composite widget its keyboard with `mountRovingFocus`, not a `keydown` handler — unless the widget is a single control with one key binding that no composite pattern describes.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-no-roving-radio",
    statement:
      'Default: leave a `RadioGroup` alone — do not mount `mountRovingFocus` on it — unless the group is not built from same-named `<input type="radio">` at all.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-filter-collapses",
    statement: "Collapse `Filter`'s unchosen chips by clipping them out of sight, never with `display:none`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-filter-group-required",
    statement: "Put every `Filter.Item` inside a `Filter.Group`, never directly in the `Filter` root.",
    detectors: [{ kind: "lint", key: "forge/interaction-filter-group-required" }],
  },
  {
    id: "forge-ui-interaction-active-item",
    statement:
      "Default: mark the item that should hold the tab stop at mount with `ACTIVE_COMPOSITE_ITEM` from `@y-core/forge/ui/contracts` — unless nothing in the composite is selected on first render, in which case the first item takes it.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-activedescendant",
    statement:
      "Default: reach for `Select` — the native `<select>` — for a listbox-shaped control, rather than building a listbox out of `div`s and pointing `mountRovingFocus` at it — unless real focus genuinely belongs on the option, as it does in a toolbar, a tab list or a menu.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-named-controllers",
    statement:
      "Default: let the registered scope mount the controller for a shipped component — `Tabs`, `Menu`, `Tooltip` — rather than re-deriving its key handling — unless the markup sits somewhere a document-level `resume()` cannot reach, such as a shadow root attached after it ran, where you call `resume(root)` on that root.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-disabled-last",
    statement:
      "Default: prefer an enabled control that explains its refusal over a disabled one that does not — unless the reason is visible within one glance of the control.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-readonly-not-disabled",
    statement:
      'Default: express "displayed but not editable" as `readonly`, never as `disabled` — unless the value should also be excluded from form submission, which is what `disabled` additionally does.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-hide-vs-disable",
    statement:
      "Default: hide a control only when the reader could never use it — never to express a transient state — unless the brief calls for progressive disclosure of an advanced group.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-hover-not-required",
    statement:
      "Default: never make hover the only route to an action — unless the action is a genuine duplicate of one that is permanently visible.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-one-moment",
    statement: "Default: author one motion moment per interaction — unless a brief raises the motion dial for a named marketing surface.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-transition-controller",
    statement:
      "Default: express entry with `starting:` and exit with `transition-discrete` on the base rule, and select open state with the `open:` and `not-open:` variants, unless the element is not a native popover, `<dialog>` or `<details>`, in which case a plain `transition-` class is correct.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-no-display-on-popup",
    statement:
      "Default: put no bare `display` utility on a `[popover]` element or a `<dialog>` — reach for `opacity`, `visibility` or a `transform` instead — unless the utility is variant-gated on the open state.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-trigger-state",
    statement:
      "Default: give a trigger its open-state feedback with a `:has()` rule that reads the popup's own `:popover-open`, rather than a listener or a mirrored attribute on the trigger — unless the popup is modal, whose `::backdrop` paints over the trigger regardless.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-duration",
    statement:
      "Default: keep an enter under 200ms and an exit shorter than its enter — roughly 120–200ms in, 80–150ms out — unless a brief specifies a slower deliberate reveal.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-interaction-no-motion-on-layout",
    statement:
      "Default: animate `transform` and `opacity` only — unless the moment is a disclosure whose whole point is the height change, as in `Collapsible` and `Accordion`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-a11y-aria-beside-data",
    statement:
      "Default: emit both the `data-` and the `aria-` half for every state you express, and emit the `data-` half through `stateAttrs` or `applyStateAttrs` rather than by writing the attribute name, unless the element is purely decorative and carries no state a reader can act on.",
    detectors: [{ kind: "lint", key: "forge/a11y-aria-beside-data" }],
  },
  {
    id: "forge-ui-a11y-state-attrs-source",
    statement:
      "Default: read state in CSS from the `data-` attribute, not from the `aria-` one, unless no `data-` attribute exists for that state, in which case add it to `STATE_ATTRS` first.",
    detectors: [{ kind: "lint", key: "forge/a11y-state-attrs-source" }],
  },
  {
    id: "forge-ui-a11y-label-element",
    statement:
      "Default: name a control with a visible `Label` or `FormField.Label` — unless the design genuinely has no room for a visible label, in which case see the screen-reader-only rule below.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-a11y-icon-plus-text",
    statement:
      'Default: when a control genuinely has no visible text — an icon-only `Button shape="icon"` — pair a decorative `Icon` with visually-hidden text rather than an `aria-label`, wherever the layout allows it — unless the sr-only span would be read twice because the control already has a name.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-icon-button-label",
    statement:
      'Default: an icon-only `Button` — `shape="icon"` or `shape="circle"` — carries an `aria-label` naming the action it performs, unless the visually-hidden span above is used instead, which is the preferred form wherever the layout allows it.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-a11y-stepper-names-its-quantity",
    statement:
      "Default: a stepper, a nudge or any repeated pair of adjacent controls names the quantity it moves, not the direction it moves it — unless the page provably renders one such pair.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-a11y-required-marker",
    statement:
      "Default: keep the required marker decorative and carry requiredness on the control — unless the form has no visual required convention at all.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-a11y-no-aria-readonly-on-button",
    statement:
      'Default: never put `aria-readonly` on a `<button>` or a `role="button"` element — carry the state on the control the button acts on, or use `disabled` — unless the element\'s role genuinely supports it.',
    detectors: [{ kind: "lint", key: "forge/a11y-no-aria-readonly-on-button" }],
  },
  {
    id: "forge-ui-a11y-spinbutton-home-end",
    statement:
      "Default: leave Home and End to a `NumberField`'s own input rather than binding them to min and max — unless the control is a spinbutton you built out of non-input elements.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-a11y-heading-size-by-class",
    statement:
      "Default: choose the heading level from the section's position in the document and set its size with a class — unless the component's own compound already fixes the tag, as `Card.Title` does.",
    detectors: [{ kind: "lint", key: "forge/a11y-heading-size-by-class" }],
  },
  {
    id: "forge-ui-a11y-reduced-motion-pair",
    statement:
      "Default: author a scale or slide inside `motion-safe:` and give `motion-reduce:` the settled state or an opacity fade in its place, rather than treating reduced motion as a later pass — unless the movement conveys information that has no static equivalent.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-a11y-one-live-region",
    statement:
      "Default: speak through `announce()` and add no live region of your own — unless the surface has a genuinely separate stream of updates, which is what a channel of its own is for.",
    detectors: [{ kind: "lint", key: "forge/a11y-one-live-region" }],
  },
  {
    id: "forge-ui-a11y-live-politeness",
    statement:
      "Default: leave an announcement polite — unless the message is a failure that stops the reader's current task, which is the only case that earns an interruption.",
    detectors: [{ kind: "lint", key: "forge/a11y-live-politeness" }],
  },
  {
    id: "forge-ui-a11y-spinner-announces",
    statement:
      'Default: pair a `Skeleton` region with one announcement, because `Skeleton` renders `aria-hidden="true"` and is silent by design — unless the wait is short enough that nothing needs to be announced.',
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-optional-prop-undefined",
    statement:
      "Default: declare every optional prop a consumer passes a value into with `undefined` in its type as well as `?`, unless the type is one an application never constructs.",
    detectors: [{ kind: "lint", key: "forge/optional-prop-undefined" }],
  },
  {
    id: "forge-ui-htmx-fragment-is-a-surface",
    statement:
      "Default: design the swap target as a standalone surface with its own boundary, heading and spacing, rather than as raw content dropped into a parent's layout — unless the fragment is a single inline value such as a count or a status word.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-htmx-fragment-states",
    statement:
      "Default: give every swappable region three states of its own — empty, in-flight, and error — before writing the success case — unless the region can never be in any of them.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-htmx-empty-fragment",
    statement:
      "Default: return the empty state from the fragment handler itself rather than branching in the parent — unless the parent must also collapse a wrapper the fragment does not own.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-htmx-swap-granularity",
    statement:
      "Default: swap the smallest region that actually changes — unless the change alters the region's relationship to its neighbours, in which case swap the container.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-htmx-reserve-space",
    statement:
      "Default: ship the swap target's placeholder in the initial page render, before any request goes out, rather than swapping one in — unless the region is not visible until the reader asks for it.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-htmx-indicator-on-control",
    statement:
      "Default: put the busy state on the control the reader touched, via `hxAttrs`' `indicator` — unless the request was not initiated by a control, as with `infiniteScroll`, where the indicator belongs at the point of insertion.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-htmx-disable-inflight",
    statement:
      "Default: disable the initiating control for the duration with `disable`, and prefer the pattern helper that already does it — unless the interaction is deliberately repeatable in flight.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-htmx-oob-flash",
    statement:
      "Default: send the outcome of a background or global action to the flash region out-of-band with `FlashOob`, rather than into the swapped surface — unless the message is _about_ the swapped content and belongs beside it.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-htmx-oob-scoped",
    statement:
      "Default: target out-of-band swaps at stable ids the page layout owns, and give each one exactly one writer — unless the region is a genuine append target such as the flash container.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-htmx-append-not-replace",
    statement:
      "Default: append with `infiniteScroll` rather than re-rendering the whole collection — unless the sort or filter changed, in which case the whole list is the smallest region that changed.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-htmx-restore-focus",
    statement:
      "Default: choose a swap target that does not contain the control that triggered the request — unless the control is genuinely part of the content being replaced.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-density-app-default",
    statement:
      "Default: an app surface is built at density 5, variance 4, and motion 3 unless a written brief sets a different value, and a dial moved by inference from the surrounding code is not a brief.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-density-infer-from-signal",
    statement:
      "Default: dial settings are inferred from the strongest signal in the brief using the signal table in this section, and the inference is stated in one line alongside the Design Read, unless the brief names the numbers itself, in which case the brief's numbers win.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-density-conflicting-signals",
    statement:
      "Default: when two signals conflict — a data table inside an onboarding wizard — the inner surface takes the denser setting and the surrounding page keeps the looser one, unless the brief describes the two as one continuous surface.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-density-button-size",
    statement:
      "Default: at density 7 or above, `Button` takes `size='sm'` and icon-only controls take `shape='icon' size='sm'`, unless the control is the surface's single primary action, which stays at `md` so the pyramid in `01-hierarchy.md` survives the compression.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-density-gap-scale",
    statement:
      "Default: raised density selects a lower step on Tailwind's spacing scale — `gap-2` in place of `gap-4` — and never an arbitrary value, unless a forge component's own class needs overriding, in which case the override is still a scale value.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-density-separator-over-card",
    statement:
      "Default: a dense list renders as rows separated by `Separator` inside a single `Card.Content`, unless each item carries its own independent set of actions and its own heading.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-density-scrollarea-region",
    statement:
      "Default: a dense region taller than its container scrolls inside a `ScrollArea` rather than extending the page, unless the region is the page's only content.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-density-tabular-numerals",
    statement:
      "Default: any column of numbers — counts, durations, currency, byte sizes — carries `tabular-nums`, unless the number appears once and is not part of a column.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-density-floor-holds",
    statement:
      "Default: a density increase is implemented by lowering spacing steps and control sizes down to the `sm` floor and no further, unless the brief supplies a different mechanism for fitting the content — pagination, a `ScrollArea`, or fewer columns — which it should, because the rules a further squeeze would break are Floor and no brief reaches them.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-density-variance-repetition",
    statement:
      "Default: surfaces of the same kind — settings panels, list views — use the same component composition and the same size vocabulary, unless a brief raises variance above forge's ratified default of 4.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-density-motion-budget",
    statement:
      "Default: authored motion is limited to state changes a user caused — open, close, dismiss — and carries no entrance animation on page load except a toast's, whose arrival answers the action that rendered the page, unless a brief raises motion above forge's ratified default of 3.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-brief-required",
    statement:
      "Apply marketing dial settings only when a written brief identifies the surface as a public-facing marketing or landing page, never by inference from a route name, a file path, or the surrounding copy.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-authenticated-stays-app",
    statement:
      "Default: a surface behind authentication is built at forge's app defaults even when its content is promotional — an upgrade prompt, a feature announcement — unless the brief names it a marketing surface explicitly.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-hero-once",
    statement:
      "Default: a marketing page opens with exactly one hero region carrying one headline, one supporting line, and one `primary` `Button`, unless the brief describes a page with two independent audiences that must be split above the fold.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-type-step-jump",
    statement:
      "Default: the hero headline is the only place a type step above `text-3xl` appears, and the jump between the headline and the supporting line is at least two steps on the type scale, unless the brief supplies its own typographic scale.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-vertical-rhythm",
    statement:
      "Default: marketing sections separate at `py-16` or larger and their internal groups at `gap-8` or larger, unless the section is a dense comparison table, which returns to the app density of `12-density.md`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-one-accent",
    statement:
      "Default: exactly one element per page uses `--primary` as a filled surface — the hero's `primary` `Button` is the usual holder — and every other call to action on the page is `secondary` or `ghost`, unless the brief specifies a repeated end-of-section call to action.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-card-feature-group",
    statement:
      "Default: a marketing feature grid renders one `Card` per feature with `Card.Title` and `Card.Description` and no per-card `Button`, unless each feature links to a materially different destination.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-accordion-faq",
    statement:
      "Default: an FAQ renders as an `Accordion` rather than as stacked `Card`s, unless every answer is short enough that all of them fit on screen at once.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-alert-notice",
    statement:
      "Default: a notice bar uses `Alert` with `neutral` or `info`, unless the notice reports a real service failure, which is the one case `destructive` is earned.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-dialog-capture",
    statement:
      "Default: a capture form opens in a `Dialog` triggered by an explicit control, and never on a timer, a scroll position, or an exit-intent listener, unless the brief specifies the trigger.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-no-invented-proof",
    statement:
      "Default: a proof element — a metric, a quote, a customer name, an `Avatar` — renders only when the real value is supplied in the brief, and otherwise the element is omitted entirely rather than filled with a placeholder, unless the brief asks for a wireframe, where each placeholder is labelled as one per `forge-ui-marketing-omit-unfilled-section`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-avatar-real-person",
    statement:
      "Default: an `Avatar` on a marketing surface carries a real person's image or their real initials through `Avatar.Fallback`, unless the brief supplies an explicitly illustrative image and says so.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-omit-unfilled-section",
    statement:
      "Default: a section that has no real content yet is left out of the page rather than rendered with sample content, unless the brief asks for a wireframe, in which case every placeholder is labelled as one in the surrounding copy.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-marketing-motion-ceiling",
    statement:
      "Default: marketing motion is limited to one entrance transition per section and the state transitions the platform's own selectors already express, and never includes a looping animation, an auto-advancing carousel, or a parallax effect, unless the brief names the effect specifically.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-review-dimension-pass",
    statement:
      "Default: a review walks every dimension in the order of the dimension table in this section before reporting any of them, because a hierarchy finding often explains a color finding and reporting the color one first sends the fix to the wrong place — unless the review is explicitly scoped to one dimension by the request.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-review-both-themes",
    statement:
      "Default: contrast, token pairing, and any dark-mode-sensitive finding is checked in both `:root` and `.dark`, and the finding names which theme it was observed in, unless the surface ships in one theme only.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-review-severity-scale",
    statement:
      "Default: assign severity by the severity table in this section, never by how visible the problem is — a failing contrast pair in a footer is P0 and a slightly tight hero gap is P3, however the two look on screen — unless the review was commissioned against an external scale its brief names, as a WCAG conformance audit grading by level is, where that scale's grades replace these and a Floor finding still reports at P0.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-review-floor-is-p0",
    statement:
      "Default: any finding citing a rule id from `floor.md` is reported at P0, and a brief that requested the violating behaviour is itself reported as a finding — unless the cited id turns out not to be a Floor rule, which is a misattribution to correct rather than a severity to negotiate.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-review-p3-budget",
    statement:
      "Default: a P3 finding is reported at most three times per review, because a report where taste notes outnumber defects gets read as a taste document and the P0s go unfixed — unless the review was explicitly requested as a polish pass.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-review-persona-pass",
    statement:
      "Default: a full review runs every persona in the persona table in this section, and each persona's findings are attributed to that persona in the report so a partial re-review can repeat exactly one of them, unless the review is scoped to a specific persona by the request.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-review-a11y-personas-always",
    statement:
      "Default: the keyboard-only and screen-reader passes are run on every review regardless of scope, because both surface P0s and neither is inferable from reading markup alone, unless the surface renders no interactive element at all.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-review-report-line",
    statement:
      "Default: every finding is one line carrying severity, rule id, `file:line`, the observation, and the fix — never a paragraph, and never a finding that describes a problem without naming the change that resolves it — unless the problem has no single line, as a surface over its text-colour budget has, where the finding cites the file alone.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-review-order-by-severity",
    statement:
      "Default: findings are ordered by severity and then by file, so the P0s are readable without scrolling, unless the report is grouped by persona for a persona-scoped review.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-review-no-rewrite",
    statement:
      "Default: a review reports findings and does not rewrite the surface, unless the request asked for the fixes to be applied, in which case the report is still produced first so each change is attributable to a rule.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-review-unattributed-finding",
    statement:
      "Default: a finding that cannot cite a rule id is either promoted into a new corpus rule or dropped before the report is written, and is never reported as an unattributed observation, unless the request explicitly asked for open-ended impressions — which is a critique, not a review, and says so in its own heading.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-review-new-rule-lands-in-corpus",
    statement:
      "Default: a newly minted rule is added to the `reference/` file owning its dimension rather than stated inline in the report, so the next review inherits it, unless the reviewer does not own the corpus, in which case the proposed rule is reported as such with its intended file.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-media-text-scrim",
    statement:
      "Default: text laid over a photograph sits above an `absolute inset-0` scrim carrying a background token at reduced opacity — `bg-background/70` under dark text, `bg-foreground/60` under light — so the ratio is once again token against token, unless the text sits beside the image rather than on it, which is the composition that needs no scrim at all.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-media-no-text-shadow",
    statement:
      "Default: where a scrim would flatten detail the image is there to show, the _image_ is treated instead — `grayscale`, or a `mix-blend-multiply` against a token surface behind it — and never the text, which keeps its token colour, unless the image is decorative enough to crop the text off it entirely.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-media-fixed-crop",
    statement:
      "Default: an image whose proportions the surface does not control — an upload, an avatar, a third-party thumbnail — renders into a fixed box, `aspect-square` or `aspect-video` with `object-cover` and `overflow-hidden` on the container, rather than at whatever ratio the file happens to carry, unless the image _is_ the content and its proportion is information, as a chart or a screenshot under review is.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-media-container-clip",
    statement:
      "Default: an image's corners come from `overflow-hidden` on its container, never from a radius utility on the image itself, so `forge-ui-one-radius` still decides the shape — as it does for `Avatar`, whose root carries `rounded-full` and `overflow-hidden` while `Avatar.Image` carries neither — unless the image is a standalone element with no container, in which case it takes the same `--radius` step it would have inherited.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-media-alt-required",
    statement:
      "Give every hand-written `<img>` an `alt`, empty only when the image is decorative and the surrounding text already says everything it says, matching the contract `Avatar.Image` enforces by typing `alt` as required rather than optional.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-media-carousel-last-resort",
    statement:
      "Default: `Carousel` holds only a set of same-kind media the reader chooses between, never content that must be read — features, testimonials, announcements — which is a list or a grid, unless the brief fixes a single-slide viewport and every slide is reachable by its own `Carousel.Dots` anchor.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-media-icon-intended-size",
    statement:
      "Default: a sprite glyph renders at `size-4`, the 16px that `Accordion.Trigger` and `Collapsible.Trigger` set and that `Select` gives its chevron, or one step up to `size-5` where it carries more weight, unless the icon set is drawn for display sizes and states the size it was drawn at.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-media-icon-enclosure",
    statement:
      "Default: where a glyph has to anchor a large slot, the _enclosure_ grows and the glyph does not — a `size-10` or `size-12` `rounded-full bg-muted` shape with a `size-4` or `size-5` `Icon` centred in it — which is the composition `Avatar` already ships and the trade `Button shape='icon'` makes at 40 pixels around a 16-pixel glyph, unless the slot is a decorative illustration carrying no control and no state.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-platform-aspect-ratio",
    statement: "Reserve a ratio box with `aspect-ratio`, never with a percentage `padding-bottom` inside a `position: relative` rule.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-centering",
    statement:
      "Centre a child by declaring `place-items: center` on its container, never with `top: 50%` and `left: 50%` pulled back by `translate(-50%, -50%)`.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-scrollbar",
    statement: "Style a scrollbar with `scrollbar-color` and `scrollbar-width`, never with the `::-webkit-scrollbar` pseudo-elements.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-line-clamp",
    statement: "Clamp text with `line-clamp`, never with `-webkit-line-clamp` and `-webkit-box-orient`.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-light-dark",
    statement: "Express a per-mode value with `light-dark()`, never by declaring the same selector a second time under `prefers-color-scheme`.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-image-set",
    statement:
      "Select a raster by device density with `image-set()`, never with a `min-resolution` or `-webkit-min-device-pixel-ratio` media query.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-isolation",
    statement: "Create a stacking context with `isolation: isolate`, never with a negative `z-index`.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-logical-spacing",
    statement: "Write inline-axis spacing logically.",
    detectors: [{ kind: "lint", key: "forge/platform-logical-spacing" }],
  },
  {
    id: "forge-ui-platform-native-dialog",
    statement:
      'Default: open a modal with `Dialog`, which renders a native `<dialog>` and takes `showModal()` through the client runtime, rather than declaring `role="dialog"`, `role="alertdialog"` or `aria-modal` on a `<div>` — unless the panel must not make the rest of the page inert and must not enter the top layer, as a non-modal inspector docked beside the content it describes must not.',
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-native-popover",
    statement:
      "Default: declare a floating panel through the Popover API, as `Popover.Content` does with `popover='auto'` against a trigger carrying `command='toggle-popover'`, rather than absolutely positioning a menu, tooltip or dropdown that declares no popover at all — unless the panel must survive an outside click or an Escape press, as a filter rail that stays open while the reader works in the table beside it must.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-native-details",
    statement:
      "Default: build a disclosure from `Collapsible` or `Accordion`, both of which render native `<details>` and `<summary>`, rather than toggling `aria-expanded` from a click handler — unless the trigger and the panel cannot be one subtree, as a header control that expands a region elsewhere in the document cannot.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-inert",
    statement:
      "Default: mark the rest of the page `inert` while focus must stay inside a subtree, rather than sweeping `tabindex` to `-1` across it and restoring the saved values afterwards — unless the excluded content must stay readable to a screen reader while unreachable by Tab, since `inert` removes the subtree from the accessibility tree as well as from the tab order.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-entry-motion",
    statement:
      "Default: express entry motion with `@starting-style` and `transition-behavior: allow-discrete` — the `starting:` and `transition-discrete` utilities `forge-ui-interaction-transition-controller` already fixes — rather than adding a class inside `requestAnimationFrame` to kick a transition off — unless the element was already in the document and is merely being revealed, which has no first style change after insertion for a starting style to apply to.",
    detectors: [{ kind: "lint", key: "forge/platform-entry-motion" }],
  },
  {
    id: "forge-ui-platform-exit-geometry",
    statement:
      "Default: declare an overlay's geometry — its size, inset, margin, padding, position, grid and transform — on the base selector, and key only `opacity`, `overlay` and `display` on `:popover-open` or `[open]` — unless the exit transitions that property too, as a disclosure's `block-size` and a closing dialog's `step-end` placement do.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-ticker",
    statement:
      "Default: declare a repeating motion as keyframes gated on `prefers-reduced-motion` rather than running a `setInterval` that mutates `style.transform`, `style.left`, `style.top` or `style.translate` — unless each step's value is computed from data that changed since the last one, which no keyframe can read.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-motion-path",
    statement:
      "Default: declare a fixed path with `offset-path` rather than computing coordinates per frame with `Math.sin` or `Math.cos` inside `requestAnimationFrame` — unless the path is derived from data at runtime, as a plotted series is, rather than fixed when the component was written.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-animated-border",
    statement:
      "Default: register a gradient's angle with `@property` and animate the `conic-gradient()` rather than mutating the angle per frame in `requestAnimationFrame` — unless the angle tracks a pointer or a scroll position rather than time, which a keyframe has no way to read.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-reveal-mask",
    statement:
      "Default: declare a reveal's mask in CSS and drive it from one custom property rather than assigning `style.clipPath` or `style.maskImage` per frame — unless a child of the masked element must stay unmasked, since a mask composites the whole element and takes its descendants with it.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-scroll-reveal",
    statement:
      "Default: drive a scroll-triggered reveal with `animation-timeline: view()` rather than adding a class from an `IntersectionObserver` callback — unless the reveal must happen once and stay, since a view timeline re-runs each time the element scrolls back into view.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-smooth-scroll",
    statement:
      "Default: declare `scroll-behavior` and clear a sticky header with `scroll-margin`, rather than animating a scroll from script with a `behavior: 'smooth'` option or `offsetTop` arithmetic — unless one call site must animate while the rest of the document stays instant, which the declarative property cannot express because it also governs the reader's own scrolling.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-carousel",
    statement:
      "Default: page a slide track with scroll snap and `::scroll-button()` rather than stepping `scrollLeft`, calling `.scrollBy()`, or translating the track by an index — unless every slide must advance by exactly one index whatever its width, since snapping steps by snap position and a track of uneven slides pages differently.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-anchor-positioning",
    statement:
      "Default: position a panel against its trigger with `anchor()`, as forge's own menu rules do against the popup's implicit anchor, rather than writing a measured `getBoundingClientRect()` into `style.top`, `style.left`, `style.right` or `style.bottom` — unless the panel is anchored to a point rather than an element, as a context menu opened at the pointer is.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-field-sizing",
    statement:
      "Default: let a `Textarea` grow with `field-sizing: content` rather than writing `scrollHeight` back into `style.height` on every input — unless the reader owns the height, which forge's `Textarea` allows: it ships `resize-y`, and a control the reader has dragged to a size should not resize itself out from under them.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-parent-state",
    statement:
      "Default: select an ancestor from a descendant's state with `:has()`, as `forge-ui-interaction-trigger-state` already does for a popup's trigger, rather than reaching `parentElement`, `parentNode` or `closest()` and calling `classList` on the result — unless the mark must persist after the state that set it is gone, as a \"has been opened once\" flag does, since `:has()` re-evaluates on every state change.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-counters",
    statement:
      "Default: number list items with CSS counters rather than writing an index into `textContent` — unless the number must be selected, copied or read back by a script, since generated content is not in the DOM.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-count-up",
    statement:
      "Default: animate a number by interpolating a registered `@property` and printing it through a counter, rather than stepping `textContent` per frame with `toFixed`, `Math.round` or `toLocaleString` inside `requestAnimationFrame` — unless assistive technology must announce the value, which generated content is never announced as.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-theme-detection",
    statement:
      "Default: resolve a per-mode value with `light-dark()` rather than reading `matchMedia('(prefers-color-scheme: …)')` in script — unless the theme is the app's rather than the OS's, which is forge's own case.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-layer",
    statement:
      "Default: order a stylesheet's cascade in named `@layer` blocks, as `forge-ui.css` does with its `components` and `utilities` layers, rather than relying on source order — unless the sheet's rules must beat every layered rule in the document, as a preference override loaded last must, since an unlayered rule outranks every layer.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-nesting",
    statement:
      "Default: author plain CSS and use native nesting rather than `.scss` or `.sass` — unless the file genuinely needs what the preprocessor has and CSS does not, such as a loop or a mixin generating rules.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-scope",
    statement:
      "Default: bound a family of five or more selectors sharing a class prefix with `@scope` rather than carrying the prefix on every one — unless the family's members are not all inside one subtree, since a scoped rule stops at the scope's lower boundary.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-selector-list",
    statement:
      "Default: group four or more selectors with `:is()` or `:where()` rather than a comma list — unless the list's own specificity is what a later rule depends on, since `:is()` takes the specificity of its most specific argument and `:where()` takes none, and neither equals the list's.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-container-query",
    statement:
      "Default: size a component against its container with `@container`, as `Field`'s `@container/field-group` does, rather than against the viewport with a `(min-width:)` or `(max-width:)` media query — unless the thing being sized really is the page, as an application shell's breakpoint is.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-subgrid",
    statement:
      "Default: inherit a parent's tracks with `subgrid` rather than restating the same `grid-template-columns` or `grid-template-rows` value in a descendant rule — unless the child's tracks only coincidentally match and are meant to move independently afterwards.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-interpolate-size",
    statement:
      "Default: transition to an `auto` height under `interpolate-size: allow-keywords` — declared once at `:root`, as `forge-ui.css` declares it — rather than standing a fixed `max-height` in for the height you actually wanted — unless the collapsed box has a real maximum of its own that is not the content's height, as a preview capped at a few lines has.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-display-contents",
    statement:
      "Default: let a wrapper's children join a `grid` or `flex` parent with `display: contents` rather than leaving an attribute-free `<div>` or `<span>` between them — unless the wrapper carries a background, border, radius or transform, every one of which disappears with the box it was painted on, or makes its children one item of the parent, as a heading and its intro inside a `gap` stack are: dissolving it puts the parent's gap between them.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-accent-color",
    statement:
      "Default: tint a native checkbox or radio with `accent-color` rather than `appearance-none` and a hand-drawn box — unless the mark itself has to be redrawn, which is what `CheckboxGroup` and `RadioGroup` do.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-view-transition",
    statement:
      "Default: cross-fade a full-document navigation by opting the stylesheet in with `@view-transition { navigation: auto; }`, rather than leaving a `location.href` assignment, a `location.assign()` or a `location.replace()` to swap the page bare — unless the navigation leaves the application, as an external link or an identity provider hand-off does, where there is no next document to capture.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-text-balance",
    statement:
      "Default: give a heading at `text-2xl` or larger the `text-balance` utility — `Card.Title`, `Dialog.Title` and `Alert.Title` are where this lands — unless the heading is a single short line that cannot wrap, or is long enough to wrap past the few lines balancing is capped at.",
    detectors: [{ kind: "lint", key: "forge/platform-text-balance" }],
  },
  {
    id: "forge-ui-platform-text-pretty",
    statement:
      "Default: give body copy `text-pretty` — the blocks already carrying `prose`, `max-w-prose` or `leading-relaxed` under `forge-ui-measure-cap` — unless the block's height was measured for a fixed box, since pretty wrapping changes the breaks and can take one more line.",
    detectors: [{ kind: "lint", key: "forge/platform-text-pretty" }],
  },
  {
    id: "forge-ui-platform-field-sizing-adopt",
    statement:
      "Default: give a `Textarea` the `field-sizing-content` utility rather than leaving `rows` to be its height — unless the reader owns the height, which `Textarea`'s own `resize-y` invites them to.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-platform-color-mix",
    statement:
      "Default: derive a suffixed shade — `-hover`, `-active`, `-subtle`, `-strong` and the rest — from the token it shades with `color-mix()`, rather than declaring a second literal beside the first, unless the derived value is one half of a pair whose ratio is measured under `forge-ui-contrast-floor`, where a mix carrying alpha composites against whatever is behind it and the value you measured is not the value that paints.",
    detectors: [{ kind: "step", label: "validate-modern-css" }],
  },
  {
    id: "forge-ui-tell-gradient-text",
    statement:
      "Default: set a headline in one semantic token — `text-foreground`, or `text-primary` when it is the page's single accent moment under `forge-ui-marketing-one-accent` — rather than a gradient fill, unless a brief supplies a brand gradient, declared in a theme file and consumed as a token.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-neon-accent",
    statement:
      "Default: an accent surface is `bg-primary text-primary-foreground` on the theme's `--primary`, with no coloured shadow behind it and no saturated hue nobody chose, unless a brief names the brand hue, set once by re-mapping `--primary`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-pure-black",
    statement:
      "Default: ground a page in `bg-background` and move every darker or lighter surface along the scale rather than to pure black, unless a brief specifies an OLED theme, which is a theme file redefining the scale's steps.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-glass-surface",
    statement:
      "Default: a raised surface is opaque — `bg-card` at level 2, `bg-popover` at levels 3 and 4, per `forge-ui-depth-popover-token` — and carries no backdrop blur, unless it genuinely overlays scrolling content and must keep it partly legible, such as a sticky page header.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-hard-shadow",
    statement:
      "Default: take a surface's elevation from `shadow-sm`, `shadow-md` or `shadow-lg` by the level it claims, per `forge-ui-depth-soft-shadow`, rather than a hard offset shadow with no blur, unless a brief calls for a deliberately flat illustrative style applied to every raised surface on the page.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-opacity-foreground",
    statement:
      "Default: give supporting text its surface's paired foreground at full opacity — `text-muted-foreground` on `--background` and `--card`, `text-primary-foreground` on `--primary` — and carry hierarchy below that by weight or size rather than by an opacity modifier, unless the fade paints only a disabled state, which `validate-faded-text` exempts.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-nested-card",
    statement:
      "Default: separate the inner regions of a `Card` with `Separator` or a borderless `bg-muted` panel, and promote peer objects to siblings of the outer `Card`, rather than nesting a `Card` inside another, unless proximity alone groups the regions, where a `gap` step from the spacing scale separates them with no device at all.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-three-card-row",
    statement:
      "Default: take the number of cards in a row from the data, and rebuild a row whose count was chosen rather than counted as `Separator`-divided rows in one `Card.Content`, per `forge-ui-density-separator-over-card`, unless the surface genuinely has that many peer objects.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-eyebrow-kicker",
    statement:
      "Default: do not set an eyebrow label above a heading — where a section genuinely needs naming, the name is the heading, sized with a class per `forge-ui-a11y-heading-size-by-class` — unless a single eyebrow names a category the heading cannot carry.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-numbered-sections",
    statement:
      "Default: leave sections unnumbered, unless they are a genuine procedure, such as a setup guide, whose step numbers the reader refers to.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-h-screen",
    statement:
      "Default: size a full-height shell with `min-h-dvh` rather than `h-screen`, and give a bounded inner region a height from the spacing scale inside a `ScrollArea` per `forge-ui-layout-scroll-area-bound`, unless the shell must not grow past the visible viewport, which takes `h-dvh`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-uniform-spacing",
    statement:
      "Default: space a surface with a small set of steps at a real ratio — the outer gap at least twice the inner one per `forge-ui-layout-group-gap-ratio`, and no two steps within 25% per `forge-ui-layout-step-distance` — rather than one value for every gap, unless the surface is a single uniform run, such as a list of peer rows, where every gap separates the same kind of thing.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-custom-scrollbar",
    statement:
      "Default: do not restyle or rebuild a scrollable region's scrollbar — a bounded region is a `ScrollArea` with a `ScrollArea.Viewport`, whose scrolling and scrollbar are the platform's — unless a brief asks for the scrollbar's colour, which `scrollbar-color` sets per `forge-ui-platform-scrollbar` and leaves the scrolling alone.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-heading-skip",
    statement:
      "Default: take a heading's level from the section's position in the document and its size from a class — `text-sm font-medium` on an `<h3>` satisfies both, and a compound that owns its heading tag takes its `level` prop — rather than changing the tag to change the size, unless the text is no heading at all, as a card's label or an eyebrow is not, which is a styled `<p>` rather than any heading tag.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-adjacent-type-steps",
    statement:
      "Default: build a type hierarchy from three or four sizes with real distance between them, per `forge-ui-type-scale-jump`, and carry emphasis by weight per `forge-ui-type-weight-over-size`, rather than from adjacent steps of the scale, unless a dense data view needs two adjacent small steps for row text and column headers.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-justified-text",
    statement:
      "Default: left-align body copy and cap it at the comfortable measure with `max-w-prose` rather than justify it, unless a brief asks for justified copy and the column hyphenates with `hyphens-auto` under a declared `lang`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-undersized-text",
    statement:
      "Default: do not set text a reader must read below `text-sm` — `text-xs` is for labels, badges and metadata, per `forge-ui-type-min-body-size` — unless a brief calls for a dense view where the small text is not the primary content.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-tracked-body",
    statement:
      "Default: give body copy no tracking utility and large text `tracking-tight`, per `forge-ui-type-tracking-body` and `forge-ui-type-tracking-large`, rather than letterspacing reading text, unless it is a short all-caps label, where `tracking-wide` compensates for the letterforms.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-invented-metric",
    statement:
      "Default: render a metric only when the real value is supplied, and omit the element entirely otherwise per `forge-ui-marketing-omit-unfilled-section`, rather than fill the slot with an invented number, unless the brief asks for a wireframe, where the slot holds a placeholder labelled as one.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-placeholder-identity",
    statement:
      "Default: render the real record, or the empty state `forge-ui-empty-state` requires, with an `Avatar` carrying a real image or real initials through `Avatar.Fallback` per `forge-ui-marketing-avatar-real-person`, rather than a placeholder name, company or address, unless the brief asks for a wireframe, where each placeholder is labelled as one per `forge-ui-marketing-omit-unfilled-section`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-invented-testimonial",
    statement:
      "Default: render a testimonial only against a real quote from a real, named source, per `forge-ui-marketing-no-invented-proof`, and omit the whole section when there is none, unless the brief asks for a wireframe, where the quote is a placeholder labelled as one per `forge-ui-marketing-omit-unfilled-section`.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-lorem-ipsum",
    statement:
      "Default: every text slot holds real copy or nothing, and a slot with no copy is removed rather than filled with placeholder filler, unless the brief asks for a wireframe and the placeholder is labelled as one.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-emoji-icon",
    statement:
      "Default: take a glyph from the sprite through `Icon`, or through a `createIcon` binding typed `ForgeIcon<Name>`, both from `@y-core/forge/ui/core`, rather than use an emoji as an icon, unless the emoji is content the user chose, as a reaction or a status they typed is, rather than an icon the interface draws.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-inline-svg",
    statement:
      "Default: add a glyph to the app's sprite and reach for it by name through the `createIcon` binding rather than hand-roll an inline SVG for it, unless the SVG is no glyph but a chart or an illustration drawn from data, which no sprite can hold.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-spinner-reflex",
    statement:
      "Default: render `Skeleton` blocks in a region's known shape, per `forge-ui-state-skeleton-shape`, and keep `Spinner` for a wait inside a control or of unknown shape, per `forge-ui-state-spinner-scope`, unless the wait is very short, where a skeleton flash is the more disruptive of the two.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-modal-reflex",
    statement:
      "Default: take the lightest overlay the job survives — `Collapsible` when the content belongs to the page, `Popover` when it is anchored to a trigger — rather than a `Dialog` for content that blocks nothing, unless it must be read before anything else proceeds or a light dismiss would lose the reader's work.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-motion-everywhere",
    statement:
      "Default: author one motion moment per interaction, on `transform` and `opacity` only and for a state change the reader caused, rather than add motion per element, unless a brief raises the motion dial for a named marketing surface.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-tell-open-state-geometry",
    statement:
      "Default: put a panel's geometry on its base selector and give its open-state rule only `opacity`, `overlay` and `display`, per `forge-ui-platform-exit-geometry` and `forge-ui-interaction-transition-controller`, rather than key the geometry on the open state, unless the geometry change is itself the motion and the exit transitions it.",
    detectors: [{ kind: "review" }],
  },
  {
    id: "forge-ui-no-h-screen",
    statement: "Size a full-height surface with a `dvh` unit, never `h-screen` or `w-screen`.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`(?<![\w-])[hw]-screen\b`,
        paths: ["src/"],
        exclude: ["src/ui/core/utils/class-groups.ts", "src/ui/design/rules.ts", "*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        pcre: true,
        level: "fail",
        examples: {
          hits: [["src/ui/chrome/shell.tsx", '<main class="h-screen">']],
          passes: [["src/ui/chrome/shell.tsx", '<main class="min-h-dvh max-h-screen">']],
        },
      },
    ],
  },
  {
    id: "forge-ui-label-classes-spelled-once",
    statement:
      "Default: spell `FIELD_LABEL_CLASSES`' class string only in `src/ui/core/field.tsx`, unless an element that is not a label — a title, a caption — shares its leading and weight.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`leading-snug font-medium|font-medium leading-snug`,
        paths: ["src/"],
        exclude: ["src/ui/core/field.tsx", "src/ui/design/rules.ts", "*.test.*", "*.browser.ts", "*.md", "*.mjs"],
        level: "warn",
        triage:
          "An element that is not a label — a title, a caption — sharing the label's leading and weight is legitimate; a label-shaped element restating `FIELD_LABEL_CLASSES` is the defect.",
        examples: {
          hits: [["src/ui/core/fieldset.tsx", '<span class="text-sm leading-snug font-medium">']],
          passes: [["src/ui/core/fieldset.tsx", "<span class={FIELD_LABEL_CLASSES}>"]],
        },
      },
    ],
  },
  {
    id: "forge-ui-no-colour-package",
    statement:
      "Default: copy a colour scale's step values in as numbers rather than depending on its package, unless the package is a build peer forge already declares for another reason, as Tailwind is.",
    detectors: [
      {
        kind: "rg",
        pattern: String.raw`"@radix-ui/colors"`,
        paths: ["."],
        include: ["package.json"],
        level: "fail",
        examples: { hits: [["package.json", '"@radix-ui/colors": "3.0.0",']], passes: [["package.json", '"tailwindcss": "^4.1.0",']] },
      },
    ],
  },
];
