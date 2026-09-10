import type { JsonPath } from "../../cli/types";
import type { Primitive } from "../../cli/types";
import type { WranglerConfig } from "../types";

export type ConfigDiff = { kind: "set"; path: JsonPath; value: Primitive } | { kind: "unsupported"; path: JsonPath; reason: string };

/**
 * A config together with the exact bytes it was parsed from.
 *
 * Write-back needs the original text, and it needs to be the same text the offsets
 * were computed against — so the source travels with the config rather than being
 * re-read later, when the user may have edited the file mid-run.
 */
export interface LoadedWranglerConfig {
  path: string;
  source: string;
  config: WranglerConfig;
}

export interface WriteOutcome {
  path: string;
  /** False when the config was already up to date — in which case no write was attempted. */
  written: boolean;
  /** How many values were spliced in. */
  edits: number;
  /** Set only on a `--force` rewrite: what that rewrite destroyed. */
  lost?: { comments: number; unsupported: string[] };
}
