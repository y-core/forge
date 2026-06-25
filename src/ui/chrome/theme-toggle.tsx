/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC } from "../../jsx/types";
import type { ForgeIcon } from "../core/icon";
import { cn } from "../core/utils/cn";
import { Resumable } from "../server/resumable";
import { scopeAttrs } from "../server/scope-attrs";
import { DEFAULT_PREF } from "./theme";

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
 * keyed off the `.dark` class and `data-theme-preference` attribute that the `theme` scope
 * sets. The `theme-{light,dark,system}-icon` classes are the contract the theme CSS depends
 * on — keep them exact. Wrapped in a `<Resumable name="theme">` scope. @public
 */
export const ThemeToggle: FC<ThemeToggleProps> = ({ icon: Icon, size = 20, class: cls }) => (
  <Resumable name='theme' state={{ pref: DEFAULT_PREF }}>
    <button type='button' aria-label='Toggle theme' class={cn(TOGGLE_BASE, cls)} {...scopeAttrs<"cycleTheme">({ onClick: "cycleTheme" })}>
      <span class='theme-light-icon'>
        <Icon name='sun' width={size} height={size} />
      </span>
      <span class='theme-dark-icon'>
        <Icon name='moon' width={size} height={size} />
      </span>
      <span class='theme-system-icon'>
        <Icon name='monitor' width={size} height={size} />
      </span>
    </button>
  </Resumable>
);
