import type { WranglerConfig } from "./types";
import type { DeploymentTarget } from "./types";

/**
 * Pages iff the config declares a build output directory and no Worker entry point.
 *
 * wrangler rejects a config that sets both, so "both" is already invalid upstream;
 * we resolve it the way wrangler's own error message advises — "use `main` if you
 * are deploying a Worker" — rather than inventing a third behaviour.
 */
export function detectTarget(config: WranglerConfig, scriptName: string): DeploymentTarget {
  const isPages = config.pages_build_output_dir != null && config.main == null;
  return { kind: isPages ? "pages" : "worker", name: scriptName };
}

/** Human-readable surface name, used verbatim in result details. */
export function describeTarget(target: DeploymentTarget): string {
  return target.kind === "pages" ? "pages project" : "worker script";
}

/**
 * A detail string that always begins with the surface it queried, so a reader can
 * tell which API a row came from: `"pages project · would create"`.
 */
export function surfaceDetail(target: DeploymentTarget, ...parts: (string | undefined)[]): string {
  return [describeTarget(target), ...parts.filter((p): p is string => Boolean(p))].join(" · ");
}
