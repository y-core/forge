import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { loadWranglerConfig } from "../../cf/config/parse";
import type { WranglerConfig } from "../../cf/types";
import { checkResult, fail } from "../finding";
import type { CheckResult } from "../types";

/** Reads the Worker config at `file` under `root`, or returns the not-found or unparseable finding a check reports in its place. @internal */
export function readWorkerConfig(
  root: string,
  file: string,
  subject: string,
  missingDetail: readonly string[] = [],
): { config: WranglerConfig } | CheckResult {
  const path = resolve(root, file);

  if (!existsSync(path)) {
    const detail = missingDetail.length === 0 ? {} : { detail: [...missingDetail] };
    return checkResult([fail(`\`${file}\` not found`, { file, ...detail })], `${subject}: no worker config`);
  }

  try {
    return { config: loadWranglerConfig(path).config };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return checkResult([fail(`\`${file}\` is not parseable: ${message}`, { file })], `${subject}: unparseable`);
  }
}
