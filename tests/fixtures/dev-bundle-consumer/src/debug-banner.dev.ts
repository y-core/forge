import type { DebugBanner } from "./types";

declare const __FORGE_DEV__: boolean | undefined;

export const debugBanner: DebugBanner = () => (typeof __FORGE_DEV__ !== "undefined" && __FORGE_DEV__ === true ? "development build" : undefined);
