import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { stripJsonc } from "../../cli/jsonc";
import { checkResult, fail } from "../finding";
import type { CheckResult, Finding } from "../types";
import type { ExposureCheckConfig } from "./types";

interface ExposureKey {
  key: string;
  consequence: string;
  detail: readonly string[];
}

const KEYS: readonly ExposureKey[] = [
  {
    key: "workers_dev",
    consequence: "an unstated `workers_dev` publishes the Worker on a `workers.dev` subdomain",
    detail: ['state "workers_dev": false to keep it off, or "workers_dev": true to say the exposure is deliberate'],
  },
  {
    key: "preview_urls",
    consequence: "an unstated `preview_urls` publishes every uploaded version on its own preview URL",
    detail: ['state "preview_urls": false to keep them off, or "preview_urls": true to say the exposure is deliberate'],
  },
  {
    key: "routes",
    consequence: "a config silent about `routes` reads identically to one whose routes were deleted by accident",
    detail: ['state the routes the Worker serves, or "routes": [] to say it serves none'],
  },
];

/** Fails on any `wrangler.jsonc` key whose default runs toward exposure being unstated — the check is about stated intent, not a particular value. @public */
export async function checkExposure(config: ExposureCheckConfig): Promise<CheckResult> {
  const { root } = config;
  const workerConfig = config.workerConfig ?? "wrangler.jsonc";
  const workerPath = resolve(root, workerConfig);

  if (!existsSync(workerPath)) {
    return checkResult([fail(`\`${workerConfig}\` not found`, { file: workerConfig })], "deployment exposure: no worker config");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonc(readFileSync(workerPath, "utf-8"))) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return checkResult([fail(`\`${workerConfig}\` is not parseable: ${message}`, { file: workerConfig })], "deployment exposure: unparseable");
  }

  const findings: Finding[] = [];
  for (const { key, consequence, detail } of KEYS) {
    if (parsed[key] !== undefined) continue;
    findings.push(fail(`\`${key}\` is unstated, and ${consequence}`, { file: workerConfig, detail: [...detail] }));
  }

  return checkResult(findings, `deployment exposure: ${KEYS.length - findings.length}/${KEYS.length} keys stated`);
}
