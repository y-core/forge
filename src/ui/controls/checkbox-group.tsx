/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, PropsWithChildren } from "../../jsx/types";
import { CheckboxGroup as CoreCheckboxGroup } from "../core/checkbox-group";
import { fieldAttr } from "../server/field-attr";

type RootProps = Parameters<typeof CoreCheckboxGroup>[0];
type CoreItemProps = Parameters<typeof CoreCheckboxGroup.Item>[0];
type BoundItemProps = Omit<CoreItemProps, "name"> & { bind: string; value: string; name?: string };

// Capture before Object.assign below would overwrite it — prevents an infinite render loop.
const OriginalItem = CoreCheckboxGroup.Item;

const BoundItem: FC<PropsWithChildren<BoundItemProps>> = ({ bind, value, name, ...props }) => (
  <OriginalItem {...props} name={name ?? bind} value={value} {...fieldAttr(bind)} data-value={value} />
);

const Root: FC<RootProps> = (props) => <CoreCheckboxGroup {...props} />;

/** Pre-bound `CheckboxGroup` whose `.Item` stamps `data-field` + `data-value`. @public */
export const CheckboxGroup = Object.assign(Root, { Item: BoundItem });
