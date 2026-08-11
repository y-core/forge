/**
 * The audited contrast pairs, as *structure* — one list, two consumers.
 *
 * `scripts/validate-contrast.ts` decides whether the shipped scheme still matches the mapping its
 * ratios were measured under. The theme customiser reports live ratios for a scheme that does not
 * exist yet. Those are different jobs on the **same** question, and if each kept its own list they
 * would answer about different pairs — the customiser would be measuring something, just not the
 * thing the audit protects. So the pair definitions live here and both import them.
 *
 * ## What is here, and what deliberately is not
 *
 * Here: which token, which role step it resolves through, what it is read against, and which WCAG
 * criterion binds it. That is the pair's identity, and it is a fact about forge's design.
 *
 * Not here: the **pinned values and measured ratios**. Those stay in `scripts/contrast-parse.ts`,
 * because they are not facts about the pair — they are a description of the *shipped* scheme, and
 * the whole point of the customiser is that the scheme is a variable. A generated scheme has its own
 * ratios; importing the shipped ones into it would be asserting the answer before doing the sum.
 *
 * ## Why each side is classified
 *
 * A pair is only computable from a generated scheme when **both** sides come from the twelve-step
 * scale. Eleven of the fifteen have at least one side on a fixed Tailwind stop — `--destructive` is
 * `var(--color-red-700)` — and forge has no Tailwind dependency, so nothing in this repository can
 * resolve those to a colour. Rather than omit them and quietly under-report, {@link ContrastSide}
 * says which kind each side is, and a consumer that cannot compute a pair can say so.
 *
 * The classification carries a real result rather than only a limitation. Every audited pair has at
 * most one dial-controlled side, and that side's **lightness is fixed by the ramp** — chroma and hue
 * are the only free parameters. So no dial setting can move an audited pair across its floor, which
 * is the customiser's central claim and the reason its levers can be trusted. `color.test.ts`
 * executes that claim across the whole lever range rather than leaving it argued.
 */

/** The WCAG success criterion a pair is bound by. Only these two appear in forge's audit. @public */
export type Criterion = "1.4.3" | "1.4.11";

/**
 * What a criterion requires, and what it is called.
 *
 * Kept beside the ids so a readout or a failure line can say *why* a floor is what it is rather than
 * printing a bare number. @public
 */
export const CRITERION: Readonly<Record<Criterion, { floor: number; name: string }>> = {
  "1.4.3": { floor: 4.5, name: "Contrast (Minimum) — text" },
  "1.4.11": { floor: 3, name: "Non-text Contrast — UI components" },
};

/**
 * One side of a pair: either a position on the generated scale, or a colour this repository cannot
 * resolve.
 *
 * `step` is **0-indexed** — step 1 of the scale is `step: 0` — so it indexes a {@link Scale} without
 * an off-by-one at every call site. The token it corresponds to is carried alongside so a readout
 * can name `--gray-11` while indexing 10. @public
 */
export type ContrastSide =
  | { readonly kind: "scale"; readonly token: string; readonly step: number }
  | { readonly kind: "fixed"; readonly token: string };

/** An audited pair: what is read, what it is read against, and what binds it. @public */
export interface ContrastPair {
  /** The semantic custom property, including its leading `--`. Declared once, in `:root`. */
  readonly token: string;
  /** Why this token is an affordance rather than decoration — printed on failure, so the reader
   *  learns what the pair is protecting rather than only that it moved. */
  readonly role: string;
  /** The role step `token` resolves through — e.g. `--gray-11`. This is the hop that carries the
   *  mode difference, and pinning it is what keeps the semantic layer mode-free. */
  readonly step: string;
  /** The thing being read — normally `step` classified. */
  readonly foreground: ContrastSide;
  /** The surface it is read against. */
  readonly background: ContrastSide;
  /** The backdrop as the audit names it, per mode, verbatim — what `contrast-parse.ts` prints. */
  readonly against: Readonly<Record<"light" | "dark", string>>;
  /** The criterion that binds this pair. `floor` is read from {@link CRITERION}. */
  readonly criterion: Criterion;
}

const gray = (step: number): ContrastSide => ({ kind: "scale", token: `--gray-${step + 1}`, step });
const fixed = (token: string): ContrastSide => ({ kind: "fixed", token });

/**
 * The fifteen audited pairs.
 *
 * Membership is the **affordance-scoping** decision from the 0.0.83 audit: a pair is here when WCAG
 * binds it — 1.4.11 for anything that identifies a control or reports a state, 1.4.3 for anything
 * that is text. A token that only paints a decorative line is in `ACCEPTED` in
 * `scripts/contrast-parse.ts` instead, with the ratio it actually measures and the reason it is
 * exempt. Exemptions stay there rather than moving here: they are claims about the shipped scheme
 * that get re-checked, not pairs a customiser reports on.
 *
 * The first four are the fully-scale pairs — both sides generated, so a customiser can compute them
 * live. The rest have a side on a fixed Tailwind stop.
 * @public
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  {
    token: "--muted-foreground",
    role: "every line of supporting text on a forge surface — Card.Description, Field's label span, FormField.Description",
    step: "--gray-11",
    foreground: gray(10),
    background: gray(2),
    against: { light: "--muted (--gray-3)", dark: "--muted (--gray-3)" },
    criterion: "1.4.3",
  },
  {
    token: "--input",
    role: "the sole boundary of every text field, textarea, select, and every other control that draws `border-input`",
    step: "--gray-10",
    foreground: gray(9),
    background: gray(2),
    against: { light: "--muted (--gray-3)", dark: "--muted (--gray-3)" },
    criterion: "1.4.11",
  },
  {
    // Split out of `--input`, which is named for a *boundary* — so an app re-pointing it to a brand
    // outline colour also repainted the `Switch` off state. Same values, so this is visually a
    // no-op; it is the coupling that changed. The measurement is thumb-on-track rather than
    // track-on-page: the thumb (`bg-background`) sitting on the track is what distinguishes off
    // from on, and for `Switch` it is the *sole* off-state indicator.
    token: "--track",
    role: "the off-state fill of the Switch and Slider tracks — the surface the thumb is read against",
    // Same step as `--input`, and that is the coupling restated rather than re-introduced: each
    // names step 10 independently. An app re-pointing `--input` still moves only `--input`; an app
    // re-pointing `--gray-10` moves both, which is exactly what a step is for.
    step: "--gray-10",
    foreground: gray(9),
    background: gray(0),
    against: { light: "the thumb, --background (--gray-1)", dark: "the thumb, --background (--gray-1)" },
    criterion: "1.4.11",
  },
  {
    token: "--ring",
    role: "the focus indicator — and it must sit one stop beyond --input, or `focus:border-ring` is a no-op in light and a focused control recedes in dark",
    // Step 11, not Radix's step 8. Radix names 8 "hovered UI element border" and draws focus rings
    // from it, but 8 measures 1.68 against the surfaces it sits on — under 1.4.11's 3:1 floor. Step
    // 11 clears it and keeps the one-step gap beyond `--input` that this role depends on.
    step: "--gray-11",
    foreground: gray(10),
    background: gray(2),
    against: { light: "--muted (--gray-3)", dark: "--muted (--gray-3)" },
    criterion: "1.4.11",
  },
  {
    // New with the accent scale, and it audits a pair that has existed unaudited all along:
    // `Button variant='primary'` has always been text on a filled surface, so 1.4.3 has always
    // bound it. It escaped notice because `--primary` was `--accent-12` — near-black — and
    // near-white on near-black is so far clear of the floor that nobody thought to check. Pointing
    // `--primary` at a *saturated* step 9 is what makes the measurement matter, so the pair gets a
    // row at the same moment it gets a colour.
    token: "--primary-foreground",
    role: "text on the primary fill — `Button variant='primary'`, the one control every forge app renders",
    // Not a scale pair, despite both sides being generated. `--accent-contrast` is `--gray-1` in
    // light and `--gray-12` in dark, so no single index describes it — the same shape as
    // `--yellow-contrast`, and for the same reason: step 9 does not invert between modes, so its
    // foreground cannot be named from one end of the ramp.
    step: "--accent-contrast",
    foreground: fixed("--accent-contrast"),
    background: fixed("--accent-9"),
    against: { light: "--primary (--accent-9)", dark: "--primary (--accent-9)" },
    criterion: "1.4.3",
  },
  {
    token: "--destructive",
    role: "error text — `text-destructive` is what FieldError, Label's required marker and Turnstile's fallback resolve to",
    step: "--red-9",
    foreground: fixed("--red-9"),
    background: gray(2),
    against: { light: "--muted (--gray-3)", dark: "--muted (--gray-3)" },
    criterion: "1.4.3",
  },
  {
    token: "--destructive-foreground",
    role: "text on a filled destructive surface — what `Button variant='destructive'` resolves to, and the reason a caller no longer picks a foreground by hand",
    // `--<hue>-contrast` is Radix's name for the foreground that sits on step 9. It is a functional
    // token rather than a step, and being mode-varying is the entire job — near-white on a light
    // mode's saturated fill, near-black on a dark mode's lighter one.
    step: "--red-contrast",
    foreground: gray(0),
    background: fixed("--destructive"),
    against: { light: "--destructive (--color-red-700)", dark: "--destructive (--color-red-300)" },
    criterion: "1.4.3",
  },
  {
    token: "--warning-foreground",
    role: "text on the warning surface; near-white on yellow-500 measured 1.83, so the pair inverts rather than darkening the hue out of meaning",
    // Declared once, in `:root`, and read as holding in both modes — the one functional token whose
    // answer does not change with the mode. The two halves are the same colour named from either
    // end of the ramp, which is why the foreground is `fixed` rather than a scale step: it is
    // `--gray-12` in light and `--gray-1` in dark, so no single index describes it.
    step: "--yellow-contrast",
    foreground: fixed("--yellow-contrast"),
    background: fixed("--warning"),
    against: { light: "--warning (--color-yellow-500)", dark: "--warning (--color-yellow-400)" },
    criterion: "1.4.3",
  },

  // ── The status family ────────────────────────────────────────────────────────────────────────
  //
  // `Alert`, `Toast`, `Badge` and the two banner strings in `src/http/fragment.ts` used to write
  // their status colours as fixed palette utilities with hand-written `dark:` twins — 28 pairs whose
  // only audit was a block comment. They are tokens now.
  //
  // Both stops of every pair come from the status hue itself, so **no neutral ramp participates**:
  // each is `fixed` on both sides, and no dial can move any of them. That is a stronger statement
  // than it looks — it means eight of the fifteen audited pairs are provably out of the
  // customiser's reach.
  //
  // The surfaces (`-subtle`, `-strong`) carry no pair of their own. A background is audited by what
  // is read against it, and each is already named as the `against` of its own foreground; a pair
  // measuring a background against nothing would assert a number with no criterion behind it.
  {
    token: "--status-danger-subtle-foreground",
    role: "the text of a failure panel — Alert and Toast `destructive`, and the `renderError` / `renderValidationErrors` banners",
    step: "--red-12",
    foreground: fixed("--red-12"),
    background: fixed("--status-danger-subtle"),
    against: { light: "--status-danger-subtle (--color-red-50)", dark: "--status-danger-subtle (--color-red-950)" },
    criterion: "1.4.3",
  },
  {
    token: "--status-danger-strong-foreground",
    role: "the text of a failure chip — `Badge variant='destructive'`, rendered at `text-xs`",
    step: "--red-11",
    foreground: fixed("--red-11"),
    background: fixed("--status-danger-strong"),
    against: { light: "--status-danger-strong (--color-red-100)", dark: "--status-danger-strong (--color-red-900)" },
    criterion: "1.4.3",
  },
  {
    token: "--status-warning-subtle-foreground",
    role: "the text of a warning panel — Alert and Toast `warning`",
    step: "--yellow-12",
    foreground: fixed("--yellow-12"),
    background: fixed("--status-warning-subtle"),
    against: { light: "--status-warning-subtle (--color-yellow-50)", dark: "--status-warning-subtle (--color-yellow-950)" },
    criterion: "1.4.3",
  },
  {
    token: "--status-warning-strong-foreground",
    role: "the text of a warning chip — `Badge variant='warning'`, rendered at `text-xs`",
    step: "--yellow-11",
    foreground: fixed("--yellow-11"),
    background: fixed("--status-warning-strong"),
    against: { light: "--status-warning-strong (--color-yellow-100)", dark: "--status-warning-strong (--color-yellow-900)" },
    criterion: "1.4.3",
  },
  {
    token: "--status-success-subtle-foreground",
    role: "the text of a success panel — Alert and Toast `success`, and the `renderSuccess` banner",
    step: "--emerald-12",
    foreground: fixed("--emerald-12"),
    background: fixed("--status-success-subtle"),
    against: { light: "--status-success-subtle (--color-emerald-50)", dark: "--status-success-subtle (--color-emerald-950)" },
    criterion: "1.4.3",
  },
  {
    token: "--status-success-strong-foreground",
    role: "the text of a success chip — `Badge variant='success'`, rendered at `text-xs`",
    step: "--emerald-11",
    foreground: fixed("--emerald-11"),
    background: fixed("--status-success-strong"),
    against: { light: "--status-success-strong (--color-emerald-100)", dark: "--status-success-strong (--color-emerald-900)" },
    criterion: "1.4.3",
  },
  {
    token: "--status-info-subtle-foreground",
    role: "the text of an informational panel — Alert and Toast `info`",
    step: "--blue-12",
    foreground: fixed("--blue-12"),
    background: fixed("--status-info-subtle"),
    against: { light: "--status-info-subtle (--color-blue-50)", dark: "--status-info-subtle (--color-blue-950)" },
    criterion: "1.4.3",
  },
  {
    token: "--status-info-strong-foreground",
    role: "the text of an informational chip — `Badge variant='info'`, rendered at `text-xs`",
    step: "--blue-11",
    foreground: fixed("--blue-11"),
    background: fixed("--status-info-strong"),
    against: { light: "--status-info-strong (--color-blue-100)", dark: "--status-info-strong (--color-blue-900)" },
    criterion: "1.4.3",
  },
];

/**
 * The pairs a generated scheme can actually be measured on — both sides on the twelve-step scale.
 *
 * Four of fifteen, and that number is the honest scope of a live readout rather than a shortfall.
 * The other eleven have a side on a Tailwind stop that nothing in this repository can resolve, and
 * they are unmovable by the dials for the same reason they are uncomputable here: they do not touch
 * the scale. @public
 */
export function scalePairs(): readonly (ContrastPair & {
  foreground: { kind: "scale"; token: string; step: number };
  background: { kind: "scale"; token: string; step: number };
})[] {
  return CONTRAST_PAIRS.filter(
    (
      pair,
    ): pair is ContrastPair & {
      foreground: { kind: "scale"; token: string; step: number };
      background: { kind: "scale"; token: string; step: number };
    } => pair.foreground.kind === "scale" && pair.background.kind === "scale",
  );
}
