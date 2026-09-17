import type { WranglerConfig } from "./types";
import type { DeploymentTarget } from "./types";

/** Pages iff the config declares a build output directory and no Worker entry point. */
export function detectTarget(config: WranglerConfig, scriptName: string): DeploymentTarget {
  const isPages = config.pages_build_output_dir != null && config.main == null;
  return { kind: isPages ? "pages" : "worker", name: scriptName };
}

/** Human-readable surface name, used verbatim in result details. */
export function describeTarget(target: DeploymentTarget): string {
  return target.kind === "pages" ? "pages project" : "worker script";
}

/** A detail string beginning with the surface it queried, so a reader can tell which API a row came from. */
export function surfaceDetail(target: DeploymentTarget, ...parts: (string | undefined)[]): string {
  return [describeTarget(target), ...parts.filter((p): p is string => Boolean(p))].join(" · ");
}
