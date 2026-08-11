/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC } from "../../jsx/types";
import { scopeAttrs } from "../contracts/scope-attrs";
import type { ForgeIcon } from "../core/icon";
import { cn } from "../core/utils/cn";
import { Resumable } from "../server/resumable";
import { DEFAULT_PREF } from "./theme";

/** Props for {@link ThemeToggle}. @public */
export interface ThemeToggleProps {
  /** Bound icon supplying the `sun`, `moon`, and `monitor` glyphs. */
  icon: ForgeIcon<"sun" | "moon" | "monitor">;
  /** Pixel size of each icon. Defaults to 20. */
  size?: number;
  /** Additional classes merged onto the toggle button. */
  class?: string;
}

const TOGGLE_BASE = "rounded-lg p-2 text-foreground transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Theme toggle button — one button that cycles light → dark → system → light.
 *
 * Visibility is driven by CSS keyed off the `.dark` class and `data-theme-preference` attribute
 * that the `theme` scope sets. The `theme-{light,dark,system}-icon` classes are the contract the
 * theme CSS depends on — keep them exact. Wrapped in a `<Resumable name="theme">` scope.
 *
 * **The accessible name tracks the theme with no JavaScript at all.** Each icon span carries its
 * own `sr-only` label, and the CSS that shows exactly one span (`display: contents`) hides the
 * other two with `display: none` — which also removes them from the accessible-name computation.
 * So the name is computed from whichever theme is active, by the same mechanism that switches the
 * glyph, and it is already correct at first paint because the FOUC script stamps
 * `data-theme-preference` before anything renders. A static `aria-label` here would announce
 * "Toggle theme" forever and never say which theme is on.
 * @public
 */
export const ThemeToggle: FC<ThemeToggleProps> = ({ icon: Icon, size = 20, class: cls }) => (
  <Resumable name='theme' state={{ pref: DEFAULT_PREF }}>
    <button type='button' class={cn(TOGGLE_BASE, cls)} {...scopeAttrs<"cycleTheme">({ onClick: "cycleTheme" })}>
      <span class='theme-light-icon'>
        <Icon name='sun' width={size} height={size} />
        <span class='sr-only'>Switch theme — currently light</span>
      </span>
      <span class='theme-dark-icon'>
        <Icon name='moon' width={size} height={size} />
        <span class='sr-only'>Switch theme — currently dark</span>
      </span>
      <span class='theme-system-icon'>
        <Icon name='monitor' width={size} height={size} />
        <span class='sr-only'>Switch theme — currently system</span>
      </span>
    </button>
  </Resumable>
);
