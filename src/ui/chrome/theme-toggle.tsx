/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC } from "../../jsx/types";
import { scopeAttrs } from "../contracts/scope-attrs";
import { THEME_SCOPE } from "../contracts/theme-toggle-contract";
import type { ThemeAction } from "../contracts/types";
import type { Size } from "../contracts/types";
import { cn } from "../core/utils/cn";
import { Resumable } from "../server/resumable";
import { DEFAULT_PREF } from "./theme";
import type { ThemeToggleProps } from "./types";

const ICON_PX: Record<Size, number> = { sm: 16, md: 20, lg: 24 };

const TOGGLE_BASE = "rounded-field p-2 text-foreground focus-ring hover:bg-accent motion-safe:transition";

// The `theme-{light,dark,system}-icon` classes are matched by the shipped theme CSS, which shows one
// span and sets the other two to `display: none` — that is also what leaves one `sr-only` label in
// the accessible name, so a static `aria-label` here would never say which theme is on.
/** One button that cycles the theme light -> dark -> system. @public */
export const ThemeToggle: FC<ThemeToggleProps> = ({ icon: Icon, size = "md", class: cls }) => {
  const px = ICON_PX[size];
  return (
    <Resumable name={THEME_SCOPE} state={{ pref: DEFAULT_PREF }}>
      <button type='button' class={cn(TOGGLE_BASE, cls)} {...scopeAttrs<ThemeAction>({ onClick: "cycleTheme" })}>
        <span class='theme-light-icon'>
          <Icon name='sun' width={px} height={px} />
          <span class='sr-only'>Switch theme — currently light</span>
        </span>
        <span class='theme-dark-icon'>
          <Icon name='moon' width={px} height={px} />
          <span class='sr-only'>Switch theme — currently dark</span>
        </span>
        <span class='theme-system-icon'>
          <Icon name='monitor' width={px} height={px} />
          <span class='sr-only'>Switch theme — currently system</span>
        </span>
      </button>
    </Resumable>
  );
};
