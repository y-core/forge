/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import type { FC } from "../../jsx/types";
import { Switch as CoreSwitch } from "../core/switch";
import { fieldAttr } from "../server/field-attr";
import { scopeAttrs } from "../server/scope-attrs";

type BoundSwitchProps = Parameters<typeof CoreSwitch>[0] & { bind: string; action?: string };

/**
 * Pre-bound `Switch` that stamps `data-on-change` + `data-field` for the resumable-scope
 * `bindField` action. The `bind` prop names the `SignalRecord` field; `action` overrides
 * the default action name `"bindField"`. @public
 */
export const Switch: FC<BoundSwitchProps> = ({ bind, action = "bindField", ...props }) => (
  <CoreSwitch {...props} {...scopeAttrs({ onChange: action })} {...fieldAttr(bind)} />
);
