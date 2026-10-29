import { isDevBuildArmed, whenArmed } from "../relax/armed";
import type { RelaxExtraOrigins } from "./types";
import { isHttpsOrLoopback, LOOPBACK_ALLOWANCE } from "./url";
import { devExtraOrigins as admitNoExtraOrigins } from "./url.strict";

/** Returns `entry` when it is a normalized https or loopback origin, and throws otherwise. @internal */
export function parseExtraOrigin(entry: string): string {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw new Error(`FORGE_DEV_ORIGINS entry is not a normalized origin: ${entry}`);
  }
  if (entry !== url.origin) {
    throw new Error(`FORGE_DEV_ORIGINS entry is not a normalized origin: ${entry}`);
  }
  if (!isHttpsOrLoopback(url)) {
    throw new Error(`FORGE_DEV_ORIGINS entry must use https: (${LOOPBACK_ALLOWANCE}): ${entry}`);
  }
  return url.origin;
}

/** The origins the comma-separated `FORGE_DEV_ORIGINS` binding names, each parsed by `parseExtraOrigin`. @internal */
export function readDevOrigins(env: unknown): readonly string[] {
  const binding = typeof env === "object" && env !== null ? (env as { FORGE_DEV_ORIGINS?: unknown }).FORGE_DEV_ORIGINS : undefined;
  if (typeof binding !== "string") return [];
  return binding
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map(parseExtraOrigin);
}

/** The `FORGE_DEV_ORIGINS` origins in a build armed for development, and none otherwise. @internal */
export const devExtraOrigins: RelaxExtraOrigins = whenArmed(isDevBuildArmed, readDevOrigins, admitNoExtraOrigins);
