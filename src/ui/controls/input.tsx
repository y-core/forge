/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import type { FC } from "../../render/jsx/types";
import { Input as CoreInput } from "../core/input";
import { createBoundControl } from "./create-bound-control";

type CoreInputProps = Parameters<typeof CoreInput>[0];

const UnformattedInput: FC<Omit<CoreInputProps, "format">> = (props) => {
  const { format: _format, ...rest } = props as CoreInputProps;
  return <CoreInput {...rest} />;
};

/** Pre-bound `Input` that stamps `data-field`. @public */
export const Input = createBoundControl(UnformattedInput);
