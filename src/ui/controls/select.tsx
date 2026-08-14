/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { Select as CoreSelect } from "../core/select";
import { createBoundControl } from "./create-bound-control";

const SelectRoot = createBoundControl(CoreSelect, { event: "onChange", defaultAction: "bindField" });

/** Pre-bound `Select` that stamps `data-on-change` + `data-field` for the `bindField` action. @public */
export const Select = Object.assign(SelectRoot, { Option: CoreSelect.Option, OptGroup: CoreSelect.OptGroup });
