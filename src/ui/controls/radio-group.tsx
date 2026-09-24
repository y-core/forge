/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, PropsWithChildren } from "../../jsx/types";
import { RadioGroup as CoreRadioGroup } from "../core/radio-group";
import { fieldAttr } from "../server/field-attr";
import { createBoundCompound } from "./create-bound-control";

type CoreItemProps = Parameters<typeof CoreRadioGroup.Item>[0];
type BoundItemProps = Omit<CoreItemProps, "name"> & { bind: string; value: string; name?: string | undefined };

const BoundItem: FC<PropsWithChildren<BoundItemProps>> = ({ bind, value, name, ...props }) => (
  <CoreRadioGroup.Item {...props} name={name ?? bind} value={value} {...fieldAttr(bind)} data-value={value} />
);

/** Pre-bound `RadioGroup` whose `.Item` stamps `data-field` + `data-value`. @public */
export const RadioGroup = createBoundCompound(CoreRadioGroup, { Item: BoundItem });
