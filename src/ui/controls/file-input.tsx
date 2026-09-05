/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { FileInput as CoreFileInput } from "../core/file-input";
import { createBoundControl } from "./create-bound-control";

/** Pre-bound `FileInput` that stamps `data-field`. @public */
export const FileInput = createBoundControl(CoreFileInput);
