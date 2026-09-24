/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, PropsWithChildren } from "../../jsx/types";
import { CheckboxGroup as CoreCheckboxGroup } from "../core/checkbox-group";
import { fieldAttr } from "../server/field-attr";
import { createBoundCompound } from "./create-bound-control";

type CoreItemProps = Parameters<typeof CoreCheckboxGroup.Item>[0];
type BoundItemProps = Omit<CoreItemProps, "name"> & { bind: string; value: string; name?: string | undefined };

const BoundItem: FC<PropsWithChildren<BoundItemProps>> = ({ bind, value, name, ...props }) => (
  <CoreCheckboxGroup.Item {...props} name={name ?? bind} value={value} {...fieldAttr(bind)} data-value={value} />
);

/** Pre-bound `CheckboxGroup` whose `.Item` stamps `data-field` + `data-value`. @public */
export const CheckboxGroup = createBoundCompound(CoreCheckboxGroup, { Item: BoundItem });
