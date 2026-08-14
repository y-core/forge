/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, PropsWithChildren } from "../../jsx/types";
import { scopeAttrs } from "../contracts/scope-attrs";
import { ToggleGroup as CoreToggleGroup } from "../core/toggle-group";
import { fieldAttr } from "../server/field-attr";

type ToggleGroupRootProps = Parameters<typeof CoreToggleGroup>[0];
type BoundToggleGroupItemProps = Parameters<typeof CoreToggleGroup.Item>[0] & { bind: string; value: string; action?: string };

// Capture before Object.assign below would overwrite it — prevents an infinite render loop.
const OriginalItem = CoreToggleGroup.Item;

const BoundItem: FC<PropsWithChildren<BoundToggleGroupItemProps>> = ({ bind, value, action = "bindGroup", ...props }) => (
  <OriginalItem {...props} {...fieldAttr(bind)} data-value={value} {...scopeAttrs({ onClick: action })} />
);

const ToggleGroupRoot: FC<ToggleGroupRootProps> = (props) => <CoreToggleGroup {...props} />;

/** Pre-bound `ToggleGroup` whose `.Item` stamps `data-field` + `data-value` + `data-on-click`. @public */
export const ToggleGroup = Object.assign(ToggleGroupRoot, { Item: BoundItem });
