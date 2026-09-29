import { CliError } from "../cli/errors";
import type { WranglerConfig } from "./types";

/** The surface every Cloudflare row is read from, as it prefixes a result detail. */
export const WORKER_SURFACE = "worker script";

/** Refuses a config declaring a Cloudflare Pages project, before any request is made. */
export function refusePagesConfig(config: WranglerConfig, scriptName: string): void {
  if (config["pages_build_output_dir"] === undefined) return;
  throw new CliError(
    "invalid-args",
    `${scriptName} declares \`pages_build_output_dir\`, a Cloudflare Pages project — forge supports Workers only. Remove it and deploy ${scriptName} as a Worker.`,
  );
}

/** A detail string beginning with the surface it queried, so a reader can tell which API a row came from. */
export function surfaceDetail(...parts: (string | undefined)[]): string {
  return [WORKER_SURFACE, ...parts.filter((p): p is string => Boolean(p))].join(" · ");
}
