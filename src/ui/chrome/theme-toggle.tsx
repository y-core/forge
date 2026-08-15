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

const TOGGLE_BASE = "rounded-lg p-2 text-foreground motion-safe:transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring";

// The `theme-{light,dark,system}-icon` classes are matched by the shipped theme CSS, which shows one
// span and sets the other two to `display: none` — that is also what leaves one `sr-only` label in
// the accessible name, so a static `aria-label` here would never say which theme is on.
/** One button that cycles the theme light -> dark -> system. @public */
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
