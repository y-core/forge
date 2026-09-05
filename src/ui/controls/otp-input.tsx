/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { OtpInput as CoreOtpInput } from "../core/otp-input";
import { createBoundControl } from "./create-bound-control";

/** Pre-bound `OtpInput` that stamps `data-field`. @public */
export const OtpInput = createBoundControl(CoreOtpInput);
