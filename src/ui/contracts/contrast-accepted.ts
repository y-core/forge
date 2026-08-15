import type { Mode } from "./color";

/** One contrast pair exempted from the audit, with what it measures and why no criterion binds. @public */
export interface AcceptedContrastRow {
  /** The custom property the exemption is about. */
  token: string;
  /** The role step it resolves through. */
  step: string;
  /** The value the step is pinned at, per mode. */
  value: Readonly<Record<Mode, string>>;
  /** Worst-case measured ratios. */
  measured: string;
  /** Why no criterion binds. Mandatory and non-empty. */
  reason: string;
}

/** The decorative contrast pairs WCAG 1.4.11 does not bind, each pinned at its measured value. @public */
export const ACCEPTED_CONTRAST: readonly AcceptedContrastRow[] = [
  {
    token: "--border",
    step: "--gray-6",
    value: { light: "oklch(88.53% 0 0)", dark: "oklch(34.85% 0 0)" },
    measured: "1.24 against --background / --card / --muted in light; 1.40 in dark",
    reason:
      "decorative separation only — a hairline, a divider, a surface edge. It identifies no control and reports no state, so WCAG 1.4.11 does not bind. It is faint by design and measured so rather than assumed: a hairline that reads as a hairline is what a surface edge should be, and recording the number is what keeps that a choice someone made rather than one nobody checked.",
  },
  {
    token: "--status-danger-border",
    step: "--red-6",
    value: { light: "var(--color-red-200)", dark: "var(--color-red-800)" },
    measured: "1.33 on --status-danger-subtle and 1.19 on --status-danger-strong in light; 1.93 and 1.20 in dark",
    reason:
      "the decorative edge of a failure panel or chip. The fill and the text carry the meaning and are both audited above; the border only bounds them, so it identifies no control and reports no state and WCAG 1.4.11 does not bind.",
  },
  {
    token: "--status-warning-border",
    step: "--yellow-6",
    value: { light: "var(--color-yellow-200)", dark: "var(--color-yellow-800)" },
    measured: "1.12 on --status-warning-subtle and 1.08 on --status-warning-strong in light; 2.12 and 1.26 in dark",
    reason:
      "the decorative edge of a warning panel or chip. Lowest of the four in light, because yellow's -50 and -200 sit close together in luminance — a fainter hairline, not a weaker signal, since the signal is the fill.",
  },
  {
    token: "--status-success-border",
    step: "--emerald-6",
    value: { light: "var(--color-emerald-200)", dark: "var(--color-emerald-800)" },
    measured: "1.21 on --status-success-subtle and 1.13 on --status-success-strong in light; 2.00 and 1.28 in dark",
    reason:
      "the decorative edge of a success panel or chip. Same argument as --status-danger-border: bounding a surface is not identifying a control.",
  },
  {
    token: "--status-info-border",
    step: "--blue-6",
    value: { light: "var(--color-blue-200)", dark: "var(--color-blue-800)" },
    measured: "1.31 on --status-info-subtle and 1.17 on --status-info-strong in light; 1.67 and 1.18 in dark",
    reason:
      "the decorative edge of an informational panel or chip. Same argument as --status-danger-border: bounding a surface is not identifying a control.",
  },
];
