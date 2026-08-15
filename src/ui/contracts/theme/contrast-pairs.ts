import type { Mode, ScaleFamily } from "./color";

/** The WCAG success criterion a pair is bound by. Only these two appear in forge's audit. @public */
export type Criterion = "1.4.3" | "1.4.11";

/** The contrast-ratio floor and title of each criterion the audit enforces. @public */
export const CRITERION: Readonly<Record<Criterion, { floor: number; name: string }>> = {
  "1.4.3": { floor: 4.5, name: "Contrast (Minimum) — text" },
  "1.4.11": { floor: 3, name: "Non-text Contrast — UI components" },
};

/** A step on a generated scale: one index, or one per mode where the token re-points. @public */
export type SideStep = number | Readonly<Record<Mode, number>>;

export type ContrastSide =
  | { readonly kind: "scale"; readonly token: string; readonly family: ScaleFamily; readonly step: SideStep }
  | { readonly kind: "fixed"; readonly token: string };

/** A side both the audit and the live measurement resolve on a generated scale. @public */
export type ScaleSide = Extract<ContrastSide, { kind: "scale" }>;

/** The step a side resolves to in one mode — the only reader of {@link SideStep}. @public */
export function sideStep(side: ScaleSide, mode: Mode): number {
  return typeof side.step === "number" ? side.step : side.step[mode];
}

export interface ContrastPair {
  readonly token: string;
  readonly role: string;
  readonly step: string;
  readonly foreground: ContrastSide;
  readonly background: ContrastSide;
  readonly against: Readonly<Record<"light" | "dark", string>>;
  readonly criterion: Criterion;
}

const gray = (step: number): ScaleSide => ({ kind: "scale", token: `--gray-${step + 1}`, family: "gray", step });
const accent = (step: number): ScaleSide => ({ kind: "scale", token: `--accent-${step + 1}`, family: "accent", step });
const fixed = (token: string): ContrastSide => ({ kind: "fixed", token });

/** `--accent-contrast`: the gray ramp's first step in light and its last in dark, one token either way. @public */
export const ACCENT_CONTRAST: ScaleSide = { kind: "scale", token: "--accent-contrast", family: "gray", step: { light: 0, dark: 11 } };

/** Every foreground/background token pair forge's contrast audit measures, with the criterion each is bound by. @public */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  {
    token: "--foreground",
    role: "body text — the single most rendered pair in the library, every unstyled run of text on a page",
    step: "--gray-12",
    foreground: gray(11),
    background: gray(0),
    against: { light: "--background (--gray-1)", dark: "--background (--gray-1)" },
    criterion: "1.4.3",
  },
  {
    token: "--card-foreground",
    role: "text on Card, and on every surface that resolves through it",
    step: "--gray-12",
    foreground: gray(11),
    background: fixed("--card"),
    against: { light: "--card", dark: "--card" },
    criterion: "1.4.3",
  },
  {
    token: "--popover-foreground",
    role: "text in Popover, Menu, Tooltip and Select's listbox",
    step: "--gray-12",
    foreground: gray(11),
    background: fixed("--popover"),
    against: { light: "--popover", dark: "--popover" },
    criterion: "1.4.3",
  },
  {
    token: "--secondary-foreground",
    role: "text on Button variant='secondary' and every secondary fill",
    step: "--gray-12",
    foreground: gray(11),
    background: fixed("--secondary"),
    against: { light: "--secondary (--gray-3)", dark: "--secondary (--gray-3)" },
    criterion: "1.4.3",
  },
  {
    token: "--accent-foreground",
    role: "text on a hovered or highlighted row — Menu.Item, Select's active option",
    step: "--gray-12",
    foreground: gray(11),
    background: fixed("--accent"),
    against: { light: "--accent (--gray-3)", dark: "--accent (--gray-3)" },
    criterion: "1.4.3",
  },
  {
    token: "--success-foreground",
    role: "text on a solid success fill — Alert and Badge in their success variant",
    step: "--emerald-contrast",
    foreground: fixed("--success-foreground"),
    background: fixed("--success"),
    against: { light: "--success (--emerald-9)", dark: "--success (--emerald-9)" },
    criterion: "1.4.3",
  },
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
    token: "--input",
    role: "the boundary of a checkbox and a radio, drawn on the page rather than in a panel — and unchanged on check, so it identifies the control in both states while the fill carries the state",
    step: "--gray-10",
    foreground: gray(9),
    background: gray(0),
    against: { light: "--background (--gray-1)", dark: "--background (--gray-1)" },
    criterion: "1.4.11",
  },
  {
    token: "--track",
    role: "the off-state fill of the Switch and Slider tracks — the surface the thumb is read against",
    step: "--gray-10",
    foreground: gray(9),
    background: gray(0),
    against: { light: "the thumb, --background (--gray-1)", dark: "the thumb, --background (--gray-1)" },
    criterion: "1.4.11",
  },
  {
    token: "--ring",
    role: "the focus indicator — and it must sit one stop beyond --input, or `focus:border-ring` is a no-op in light and a focused control recedes in dark",
    step: "--gray-11",
    foreground: gray(10),
    background: gray(2),
    against: { light: "--muted (--gray-3)", dark: "--muted (--gray-3)" },
    criterion: "1.4.11",
  },
  {
    token: "--primary-foreground",
    role: "text on the primary fill — `Button variant='primary'`, the one control every forge app renders",
    step: "--accent-contrast",
    foreground: ACCENT_CONTRAST,
    background: accent(8),
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
    step: "--red-contrast",
    foreground: gray(0),
    background: fixed("--destructive"),
    against: { light: "--destructive (--color-red-700)", dark: "--destructive (--color-red-300)" },
    criterion: "1.4.3",
  },
  {
    token: "--warning-foreground",
    role: "text on the warning surface; near-white on yellow-500 measured 1.83, so the pair inverts rather than darkening the hue out of meaning",
    step: "--yellow-contrast",
    foreground: fixed("--yellow-contrast"),
    background: fixed("--warning"),
    against: { light: "--warning (--color-yellow-500)", dark: "--warning (--color-yellow-400)" },
    criterion: "1.4.3",
  },

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

/** A pair whose two sides are both steps on a generated scale. @public */
export type ScalePair = ContrastPair & { foreground: ScaleSide; background: ScaleSide };

/** The pairs whose two sides are both steps on a generated scale, narrowed to that shape. @public */
export function scalePairs(): readonly ScalePair[] {
  return CONTRAST_PAIRS.filter((pair): pair is ScalePair => pair.foreground.kind === "scale" && pair.background.kind === "scale");
}
