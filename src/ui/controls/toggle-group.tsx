/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, PropsWithChildren } from "../../jsx/types";
import { ToggleGroup as CoreToggleGroup } from "../core/toggle-group";
import { fieldAttr } from "../server/field-attr";
import { scopeAttrs } from "../server/scope-attrs";

// Intentionally NOT built via `createBoundControl`: the binding lives on the `.Item`
// sub-component (not the root), stamps an extra `data-value`, and delegates on `onClick` with the
// `bindGroup` action — a shape the single-element `event`/`bind`/`data-field` factory can't express.
type ToggleGroupRootProps = Parameters<typeof CoreToggleGroup>[0];
type BoundToggleGroupItemProps = Parameters<typeof CoreToggleGroup.Item>[0] & { bind: string; value: string; action?: string };

// Capture before Object.assign below would overwrite it — prevents an infinite render loop.
const OriginalItem = CoreToggleGroup.Item;

const BoundItem: FC<PropsWithChildren<BoundToggleGroupItemProps>> = ({ bind, value, action = "bindGroup", ...props }) => (
  <OriginalItem {...props} {...fieldAttr(bind)} data-value={value} {...scopeAttrs({ onClick: action })} />
);

const ToggleGroupRoot: FC<ToggleGroupRootProps> = (props) => <CoreToggleGroup {...props} />;

/**
 * Pre-bound `ToggleGroup` with a bound `.Item` sub-component. `.Item` stamps `data-field` +
 * `data-value` + `data-on-click` for the resumable-scope `bindGroup` action. The `bind` prop
 * names the `SignalRecord` field; `action` overrides the default action name `"bindGroup"`. @public
 */
export const ToggleGroup = Object.assign(ToggleGroupRoot, { Item: BoundItem });
