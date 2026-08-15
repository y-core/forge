/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { Select as CoreSelect } from "../core/select";
import { createBoundControl } from "./create-bound-control";

const SelectRoot = createBoundControl(CoreSelect);

/** Pre-bound `Select` that stamps `data-field`. @public */
export const Select = Object.assign(SelectRoot, { Option: CoreSelect.Option, OptGroup: CoreSelect.OptGroup });
