/**
 * Bound control variants that intentionally shadow the `ui/core` component names.
 *
 * `Input` / `Select` / `Slider` / `Switch` / `Textarea` / `ToggleGroup` here wrap their `ui/core`
 * bases and add a `bind` prop (plus optional `action`), pre-spreading `scopeAttrs` + `fieldAttr`
 * for the resumable-scope signal contract. The names are deliberately identical to `ui/core` and
 * must NOT be renamed — the two variants live on separate subpaths (`@y-core/forge/ui/core` vs
 * `@y-core/forge/ui/controls`). A module must import a given control name from exactly one of
 * the two barrels, never both. See `.decisions/NAMESPACE_DESIGN.md` §5b.
 */
export type { ToggleGroupItemSize } from "../core/toggle-group";
export { Input } from "./input";
export { Select } from "./select";
export { Slider } from "./slider";
export { Switch } from "./switch";
export { Textarea } from "./textarea";
export { ToggleGroup } from "./toggle-group";
