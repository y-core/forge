import type { RelaxExtraOrigins } from "./types";

/** Admits no origin beyond the configured ones, whatever the bindings carry. @internal */
export const devExtraOrigins: RelaxExtraOrigins = () => [];
