/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, PropsWithChildren } from "../../jsx/types";
import { ToggleGroup as CoreToggleGroup } from "../core/toggle-group";
import { fieldAttr } from "../server/field-attr";
import { createBoundCompound } from "./create-bound-control";

type CoreItemProps = Parameters<typeof CoreToggleGroup.Item>[0];
type BoundItemProps = Omit<CoreItemProps, "name"> & { bind: string; value: string; name?: string | undefined };

// `name` defaults to the bound field: for a bound group the signal *is* the field, and making the
// caller repeat it invites the two drifting apart.
const BoundItem: FC<PropsWithChildren<BoundItemProps>> = ({ bind, value, name, ...props }) => (
  <CoreToggleGroup.Item {...props} name={name ?? bind} value={value} {...fieldAttr(bind)} data-value={value} />
);

/** Pre-bound `ToggleGroup` whose `.Item` stamps `data-field` + `data-value`. @public */
export const ToggleGroup = createBoundCompound(CoreToggleGroup, { Item: BoundItem });
