import { APPEARANCES, type Appearance, type Tone, TONES } from "../../contracts/vocabulary";
import { cva } from "./cva";

export { APPEARANCES, type Appearance, type Tone, TONES };

// The six properties per tone, and the recipe grid that reads them: `UI_SSR_COMPONENTS.md` §3h.
const TONE_VARS: Record<Tone, string> = {
  neutral:
    "[--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] " +
    "[--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)]",
  primary:
    "[--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] " +
    "[--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)]",
  secondary:
    "[--tone:var(--color-secondary)] [--tone-fg:var(--color-secondary-foreground)] [--tone-text:var(--color-muted-foreground)] " +
    "[--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-muted-foreground)] [--tone-soft-border:var(--color-border)]",
  destructive:
    "[--tone:var(--color-destructive)] [--tone-fg:var(--color-destructive-foreground)] [--tone-text:var(--color-destructive-text)] " +
    "[--tone-soft:var(--color-status-danger-subtle)] [--tone-soft-fg:var(--color-status-danger-subtle-foreground)] [--tone-soft-border:var(--color-status-danger-border)]",
  info:
    "[--tone:var(--color-info)] [--tone-fg:var(--color-info-foreground)] [--tone-text:var(--color-info-text)] " +
    "[--tone-soft:var(--color-status-info-subtle)] [--tone-soft-fg:var(--color-status-info-subtle-foreground)] [--tone-soft-border:var(--color-status-info-border)]",
  success:
    "[--tone:var(--color-success)] [--tone-fg:var(--color-success-foreground)] [--tone-text:var(--color-success-text)] " +
    "[--tone-soft:var(--color-status-success-subtle)] [--tone-soft-fg:var(--color-status-success-subtle-foreground)] [--tone-soft-border:var(--color-status-success-border)]",
  warning:
    "[--tone:var(--color-warning)] [--tone-fg:var(--color-warning-foreground)] [--tone-text:var(--color-warning-text)] " +
    "[--tone-soft:var(--color-status-warning-subtle)] [--tone-soft-fg:var(--color-status-warning-subtle-foreground)] [--tone-soft-border:var(--color-status-warning-border)]",
};

// The ring is read against the appearance's own surface, so every recipe names its own
// `--focus-ring` and none inherits a solid ancestor's (`THEME_GENERATION.md` §3d).
const APPEARANCE_RECIPES: Record<Appearance, string> = {
  solid:
    "border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]",
  soft: "border-(--tone-soft-border) bg-(--tone-soft) text-(--tone-soft-fg) [--focus-ring:var(--color-ring)] hover:bg-[color-mix(in_oklab,var(--tone-soft),var(--tone)_8%)]",
  outline: "border-(--tone-text) bg-transparent text-(--tone-text) [--focus-ring:var(--color-ring)] hover:bg-(--tone-soft)",
  ghost: "border-transparent bg-transparent text-(--tone-text) [--focus-ring:var(--color-ring)] hover:bg-(--tone-soft)",
  link: "border-transparent bg-transparent text-(--tone-text) [--focus-ring:var(--color-ring)] underline-offset-4 hover:underline",
};

/** Resolves the `tone` × `appearance` paint every toned component composes over. @public */
export const toneVariants = cva({
  variants: { tone: TONE_VARS, appearance: APPEARANCE_RECIPES },
  defaultVariants: { tone: "neutral", appearance: "solid" },
});

/** The tone's six custom properties alone, so an element can hand them to descendants without painting itself. @internal */
export function toneTokens(tone: Tone): string {
  return TONE_VARS[tone];
}
