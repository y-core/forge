/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import type { FC, PropsWithChildren } from "../../jsx/types";
import { Select as RawSelect } from "../core/select";
import { Slider as RawSlider } from "../core/slider";
import { Switch as RawSwitch } from "../core/switch";
import { ToggleGroup as RawToggleGroup } from "../core/toggle-group";
import { fieldAttr } from "../server/field-attr";
import { scopeAttrs } from "../server/scope-attrs";

type BoundSwitchProps = Parameters<typeof RawSwitch>[0] & { bind: string };
type BoundSliderProps = Parameters<typeof RawSlider>[0] & { bind: string };
type BoundSelectProps = Parameters<typeof RawSelect>[0] & { bind: string };
type BoundToggleGroupItemProps = Parameters<typeof RawToggleGroup.Item>[0] & { bind: string; value: string };

/**
 * Pre-binds forge `Switch`, `Slider`, `Select`, and `ToggleGroup.Item` to a resumable-scope
 * action and a `SignalRecord` field name. The action name is captured once; call sites write
 * `bind="fov"` instead of manually spreading `scopeAttrs` + `fieldAttr` on every control.
 *
 * `A` is the app's action-name union — passing it keeps the action name compile-checked against
 * the same union the client-side `registerScope` uses.
 *
 * The `bind` prop is orthogonal to the existing `field?: FieldDescriptor`: `field` wires
 * `id`/`name`/`aria-*` for form accessibility; `bind` wires `data-field`/`data-on-<event>` for
 * signal binding. Both may coexist on one control.
 *
 * `ToggleGroup.Item` takes a required `value` prop stamped as `data-value` — pair with the
 * client-side `bindGroup(signals)` action, which reads `data-field` + `data-value` and writes the
 * raw string into the matching signal.
 *
 * @example
 * ```tsx
 * const Bound = bindControls<ChromeAction>("bindField");
 *
 * <Bound.Switch bind="gridVisible" checked={settings.gridVisible}>Grid</Bound.Switch>
 * <Bound.Slider bind="fov" min={1} max={120} value={settings.fov} output />
 * <Bound.Select bind="language" icon={AppIcon}>
 *   <Bound.Select.Option value="en">English</Bound.Select.Option>
 * </Bound.Select>
 * <Bound.ToggleGroup aria-label="Projection">
 *   <Bound.ToggleGroup.Item bind="projection" value="perspective" pressed={...}>
 *     Perspective
 *   </Bound.ToggleGroup.Item>
 * </Bound.ToggleGroup>
 * ```
 *
 * @public
 */
export function bindControls<A extends string>(action: A = "bindField" as A) {
  const Switch: FC<BoundSwitchProps> = ({ bind, ...props }) => (
    <RawSwitch {...props} {...scopeAttrs<A>({ onChange: action })} {...fieldAttr(bind)} />
  );

  const Slider: FC<BoundSliderProps> = ({ bind, ...props }) => (
    <RawSlider {...props} {...scopeAttrs<A>({ onInput: action })} {...fieldAttr(bind)} />
  );

  const SelectRoot: FC<PropsWithChildren<BoundSelectProps>> = ({ bind, ...props }) => (
    <RawSelect {...props} {...scopeAttrs<A>({ onChange: action })} {...fieldAttr(bind)} />
  );
  const Select = Object.assign(SelectRoot, { Option: RawSelect.Option, OptGroup: RawSelect.OptGroup });

  // Capture before Object.assign below would overwrite it — prevents an infinite render loop.
  const OriginalItem = RawToggleGroup.Item;
  const BoundItem: FC<PropsWithChildren<BoundToggleGroupItemProps>> = ({ bind, value, ...props }) => (
    <OriginalItem {...props} {...fieldAttr(bind)} data-value={value} {...scopeAttrs<A>({ onClick: action })} />
  );
  // New root wrapper — never mutate the imported RawToggleGroup.
  type ToggleGroupRootProps = Parameters<typeof RawToggleGroup>[0];
  const ToggleGroupRoot: FC<ToggleGroupRootProps> = (props) => <RawToggleGroup {...props} />;
  const ToggleGroup = Object.assign(ToggleGroupRoot, { Item: BoundItem });

  return { Switch, Slider, Select, ToggleGroup };
}
