/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, PropsWithChildren } from "../../jsx/types";
import { RadioGroup as CoreRadioGroup } from "../core/radio-group";
import { fieldAttr } from "../server/field-attr";

type RootProps = Parameters<typeof CoreRadioGroup>[0];
type CoreItemProps = Parameters<typeof CoreRadioGroup.Item>[0];
type BoundItemProps = Omit<CoreItemProps, "name"> & { bind: string; value: string; name?: string };

// Capture before Object.assign below would overwrite it — prevents an infinite render loop.
const OriginalItem = CoreRadioGroup.Item;

const BoundItem: FC<PropsWithChildren<BoundItemProps>> = ({ bind, value, name, ...props }) => (
  <OriginalItem {...props} name={name ?? bind} value={value} {...fieldAttr(bind)} data-value={value} />
);

const Root: FC<RootProps> = (props) => <CoreRadioGroup {...props} />;

/** Pre-bound `RadioGroup` whose `.Item` stamps `data-field` + `data-value`. @public */
export const RadioGroup = Object.assign(Root, { Item: BoundItem });
