import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { v } from "../../../validation/mod";
import { loadConfig } from "../../assets/config";
import { deployRoot } from "../../assets/paths";
import { DEFAULT_ASSETS_PATH } from "../../assets/pipeline";
import {
  ABSENT_FILE,
  fileDigest,
  recordedPath,
  SERVICE_WORKER_FILE,
  serviceWorkerOptionsDigest,
  serviceWorkerRecordPath,
} from "../../assets/service-worker";
import { ServiceWorkerRecordSchema } from "../../assets/types";
import type { ServiceWorkerRecord } from "../../assets/types";
import { checkResult, fail } from "../finding";
import type { CheckResult, GateTier } from "../types";
import type { ServiceWorkerCheckConfig } from "./types";

const BUILD_HINT = "run `forge assets build` (an app's `build:assets`) to rebuild the worker from its current sources";

function readRecord(path: string): ServiceWorkerRecord | undefined {
  try {
    const parsed = v.safeParse(ServiceWorkerRecordSchema, JSON.parse(readFileSync(path, "utf-8")));
    return parsed.success ? parsed.output : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

type Drift = { input: string; message: string } | { record: string; message: string };

function driftOf(root: string, record: ServiceWorkerRecord, path: string, digest: string, steers: boolean): Drift[] {
  const full = resolve(root, path);
  const built = `\`${record.worker}\` was built from \`${record.entry}\``;
  if (!existsSync(full)) {
    if (digest === ABSENT_FILE) return [];
    return [{ input: path, message: `\`${path}\`, which \`${record.worker}\` was built from, no longer exists` }];
  }
  if (digest === ABSENT_FILE) return [{ input: path, message: `\`${path}\` appeared since ${built}` }];
  if (!statSync(full).isFile()) return [{ record: path, message: `the record names \`${path}\`, which is not a file` }];
  if (fileDigest(full) === digest) return [];
  return [
    {
      input: path,
      message: steers ? `\`${path}\`, which steers how \`${record.entry}\` resolves, changed since ${built}` : `\`${path}\` changed since ${built}`,
    },
  ];
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Checks the built service worker is the file its recorded build wrote, from inputs that have not changed since. @public */
export async function checkServiceWorker(config: ServiceWorkerCheckConfig, tier: GateTier): Promise<CheckResult> {
  const { root } = config;
  const resolved = await loadConfig({ root, configPath: config.assetConfig, env: process.env });
  const serviceWorker = resolved.js.serviceWorker;
  if (serviceWorker === null) return checkResult([], "service worker: none configured");

  const entry = recordedPath(root, serviceWorker.entry);
  const worker = recordedPath(root, join(deployRoot(root, resolved.paths.publicDir), SERVICE_WORKER_FILE));
  const recordFile = serviceWorkerRecordPath(config.assetsPath ?? DEFAULT_ASSETS_PATH);
  const missingBuild = (message: string, summary: string) => checkResult([fail(message, { file: recordFile, detail: [BUILD_HINT] })], summary);

  if (!existsSync(resolve(root, recordFile))) {
    if (tier === "static") return checkResult([], "service worker: no recorded build, nothing to verify");
    return missingBuild(
      `\`${entry}\` has no recorded build, so \`${worker}\` cannot be shown current with it`,
      "service worker: no recorded build",
    );
  }

  const record = readRecord(resolve(root, recordFile));
  if (record === undefined) return missingBuild(`\`${recordFile}\` is not a service-worker record`, "service worker: unreadable record");
  if (record.entry !== entry || record.worker !== worker) {
    return missingBuild(
      `the recorded build wrote \`${record.worker}\` from \`${record.entry}\`, but the config now builds \`${worker}\` from \`${entry}\``,
      "service worker: config moved since the recorded build",
    );
  }

  const workerPath = resolve(root, worker);
  if (!existsSync(workerPath)) {
    return missingBuild(`\`${worker}\` is missing, though a build of \`${entry}\` is recorded`, "service worker: built file missing");
  }
  if (fileDigest(workerPath) !== record.sha256) {
    return missingBuild(`\`${worker}\` is not the file the recorded build of \`${entry}\` wrote`, "service worker: built file replaced");
  }

  const fileFinding = (drift: Drift) =>
    "input" in drift
      ? fail(drift.message, { file: record.worker, detail: [BUILD_HINT] })
      : fail(drift.message, { file: recordFile, detail: [BUILD_HINT] });
  const inputDrift = Object.entries(record.inputs).flatMap(([path, digest]) => driftOf(root, record, path, digest, false));
  const resolutionDrift = Object.entries(record.resolution).flatMap(([path, digest]) => driftOf(root, record, path, digest, true));
  const optionsDrift =
    serviceWorkerOptionsDigest(serviceWorker, root, record.minify) === record.options
      ? []
      : [
          fail(`\`${config.assetConfig}\` now builds \`${entry}\` with options other than \`${worker}\` was built with`, {
            file: config.assetConfig,
            detail: [BUILD_HINT],
          }),
        ];
  const findings = [...inputDrift.map(fileFinding), ...resolutionDrift.map(fileFinding), ...optionsDrift];

  const inputs = plural(Object.keys(record.inputs).length, "input");
  if (findings.length === 0) return checkResult([], `service worker: \`${worker}\` current with the ${inputs} of \`${entry}\``);
  if (inputDrift.length === 0) return checkResult(findings, `service worker: \`${worker}\` is behind how \`${entry}\` builds`);
  return checkResult(findings, `service worker: \`${worker}\` is behind ${inputDrift.length} of the ${inputs} of \`${entry}\``);
}
