/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { createCheckableGroup } from "./checkable-group";

/** A set of checkboxes sharing one name, wired to `core/field.tsx`'s description and error plumbing. @public */
export const CheckboxGroup = createCheckableGroup("checkbox");
