/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC, PropsWithChildren } from "../../jsx/types";
import { Select as CoreSelect } from "../core/select";
import { fieldAttr } from "../server/field-attr";
import { scopeAttrs } from "../server/scope-attrs";

type BoundSelectProps = Parameters<typeof CoreSelect>[0] & { bind: string; action?: string };

const SelectRoot: FC<PropsWithChildren<BoundSelectProps>> = ({ bind, action = "bindField", ...props }) => (
  <CoreSelect {...props} {...scopeAttrs({ onChange: action })} {...fieldAttr(bind)} />
);

/**
 * Pre-bound `Select` that stamps `data-on-change` + `data-field` for the resumable-scope
 * `bindField` action. Requires an `icon` prop (forwarded to `core/Select` for the chevron).
 * The `bind` prop names the `SignalRecord` field; `action` overrides the default action name.
 * `.Option` and `.OptGroup` are re-exported unchanged. @public
 */
export const Select = Object.assign(SelectRoot, { Option: CoreSelect.Option, OptGroup: CoreSelect.OptGroup });
