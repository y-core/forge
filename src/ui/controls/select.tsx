/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { Select as CoreSelect } from "../core/select";
import { createBoundControl } from "./create-bound-control";

const SelectRoot = createBoundControl(CoreSelect, { event: "onChange", defaultAction: "bindField" });

/**
 * Pre-bound `Select` that stamps `data-on-change` + `data-field` for the resumable-scope
 * `bindField` action. Requires an `icon` prop (forwarded to `core/Select` for the chevron).
 * The `bind` prop names the `SignalRecord` field; `action` overrides the default action name.
 * `.Option` and `.OptGroup` are re-exported unchanged. @public
 */
export const Select = Object.assign(SelectRoot, { Option: CoreSelect.Option, OptGroup: CoreSelect.OptGroup });
