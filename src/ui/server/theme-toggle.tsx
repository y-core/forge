/** @jsxImportSource @y-core/forge */
import type { FC } from "hono/jsx";
import type { ForgeIcon } from "../core/icon";
import { cn } from "../core/utils/cn";

interface ThemeToggleProps {
  /** Bound icon supplying the `sun`, `moon`, and `monitor` glyphs. */
  icon: ForgeIcon<"sun" | "moon" | "monitor">;
  /** Pixel size of each icon. Defaults to 20. */
  size?: number;
  /** Additional classes merged onto the toggle button. */
  class?: string;
}

const TOGGLE_BASE = "rounded-lg p-2 text-foreground transition hover:bg-accent";

/**
 * Theme toggle button. Renders the light/dark/system icons; visibility is driven by CSS
 * keyed off the `.dark` class and `data-theme-preference` attribute that `mountTheme` sets.
 * The `data-ref="theme-toggle"` hook and the `theme-{light,dark,system}-icon` classes are the
 * contract `mountTheme` (and the theme CSS) depend on — keep them exact. @public
 */
export const ThemeToggle: FC<ThemeToggleProps> = ({ icon: Icon, size = 20, class: cls }) => (
  <button type="button" data-ref="theme-toggle" aria-label="Toggle theme" class={cn(TOGGLE_BASE, cls)}>
    <span class="theme-light-icon">
      <Icon name="sun" width={size} height={size} />
    </span>
    <span class="theme-dark-icon">
      <Icon name="moon" width={size} height={size} />
    </span>
    <span class="theme-system-icon">
      <Icon name="monitor" width={size} height={size} />
    </span>
  </button>
);
