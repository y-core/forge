/** The resolution conditions wrangler bundles a module Worker under. @internal */
export const WRANGLER_CONDITIONS: readonly string[] = ["workerd", "worker", "browser"];

/** The build condition that resolves each `#relax/*` import to its development module. @internal */
export const DEV_CONDITION = "forge-dev";

/** A `WRANGLER_BUILD_CONDITIONS` value carrying `forge-dev` once, built on wrangler's defaults when `current` is unset. @internal */
export function appendForgeDev(current: string | undefined): string {
  const listed = current === undefined ? [...WRANGLER_CONDITIONS] : current.split(",").map((condition) => condition.trim());
  const kept = listed.filter((condition) => condition.length > 0 && condition !== DEV_CONDITION);
  return [...kept, DEV_CONDITION].join(",");
}
