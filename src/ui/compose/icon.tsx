/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, PropsWithChildren } from "../../jsx/types";
import type { ForgeIcon } from "../core/icon";
import { Select as RawSelect } from "../core/select";
import { Spinner as RawSpinner } from "../core/spinner";
import { ThemeToggle as RawThemeToggle } from "../server/theme-toggle";

/** Icon names every `bindIcon` component requires. The injected icon must supply all of them. */
type UIIconName = "spinner" | "chevron-down" | "sun" | "moon" | "monitor";

type SpinnerProps = Omit<Parameters<typeof RawSpinner>[0], "icon">;
type SelectProps = Omit<Parameters<typeof RawSelect>[0], "icon">;
type ThemeToggleProps = Omit<Parameters<typeof RawThemeToggle>[0], "icon">;

/**
 * Binds sprite-backed forge components to an app-provided icon, mirroring the `createIcon`
 * pattern: the app calls this once with its generated `CoreIcon` and renders the returned
 * components without threading an `icon` prop at each call site.
 *
 * Typed to require an icon supplying every {@link UIIconName}; an app icon bound to a wider name
 * set is assignable, but its sprite must contain all of them or the call fails to compile. @public
 */
export function bindIcon(icon: ForgeIcon<UIIconName>) {
  const Spinner: FC<SpinnerProps> = (props) => <RawSpinner {...props} icon={icon} />;

  const SelectRoot: FC<PropsWithChildren<SelectProps>> = (props) => <RawSelect {...props} icon={icon} />;
  const Select = Object.assign(SelectRoot, { Option: RawSelect.Option, OptGroup: RawSelect.OptGroup });

  const ThemeToggle: FC<ThemeToggleProps> = (props) => <RawThemeToggle {...props} icon={icon} />;

  return { Spinner, Select, ThemeToggle };
}
