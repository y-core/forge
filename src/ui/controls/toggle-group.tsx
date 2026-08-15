/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, PropsWithChildren } from "../../jsx/types";
import { ToggleGroup as CoreToggleGroup } from "../core/toggle-group";
import { fieldAttr } from "../server/field-attr";

type ToggleGroupRootProps = Parameters<typeof CoreToggleGroup>[0];
type CoreItemProps = Parameters<typeof CoreToggleGroup.Item>[0];
type BoundToggleGroupItemProps = Omit<CoreItemProps, "name"> & { bind: string; value: string; name?: string };

// Capture before Object.assign below would overwrite it — prevents an infinite render loop.
const OriginalItem = CoreToggleGroup.Item;

// `name` defaults to the bound field: for a bound group the signal *is* the field, and making the
// caller repeat it invites the two drifting apart.
const BoundItem: FC<PropsWithChildren<BoundToggleGroupItemProps>> = ({ bind, value, name, ...props }) => (
  <OriginalItem {...props} name={name ?? bind} value={value} {...fieldAttr(bind)} data-value={value} />
);

const ToggleGroupRoot: FC<ToggleGroupRootProps> = (props) => <CoreToggleGroup {...props} />;

/** Pre-bound `ToggleGroup` whose `.Item` stamps `data-field` + `data-value`. @public */
export const ToggleGroup = Object.assign(ToggleGroupRoot, { Item: BoundItem });
