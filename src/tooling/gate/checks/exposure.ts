import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { stripJsonc } from "../../cli/jsonc";
import { checkResult, fail } from "../finding";
import type { CheckResult, Finding } from "../types";
import type { ExposureCheckConfig, ExposurePosture } from "./types";

interface ExposureKey {
  key: string;
  /** What `require: "unroutable"` asks for, in the spelling the message quotes. */
  want: string;
  holds: (value: unknown) => boolean;
}

interface ExposureControl {
  /** The keys that can settle it. The first is the one an unstated finding names. */
  keys: readonly [ExposureKey, ...ExposureKey[]];
  consequence: string;
  detail: readonly string[];
  /** The remedy when a stated key sits at a routable value. Read only under `"unroutable"`. */
  strictDetail: readonly string[];
  /** What it means to state more than one of `keys`. Present only on a multi-key control. */
  conflict?: { message: string; detail: readonly string[] };
}

const CONTROLS: readonly ExposureControl[] = [
  {
    keys: [{ key: "workers_dev", want: "`false`", holds: (value) => value === false }],
    consequence: "an unstated `workers_dev` publishes the Worker on a `workers.dev` subdomain",
    detail: ['state "workers_dev": false to keep it off, or "workers_dev": true to say the exposure is deliberate'],
    strictDetail: ['state "workers_dev": false, or drop `require: "unroutable"` to say the exposure is deliberate'],
  },
  {
    keys: [{ key: "preview_urls", want: "`false`", holds: (value) => value === false }],
    consequence: "an unstated `preview_urls` publishes every uploaded version on its own preview URL",
    detail: ['state "preview_urls": false to keep them off, or "preview_urls": true to say the exposure is deliberate'],
    strictDetail: ['state "preview_urls": false, or drop `require: "unroutable"` to say the exposure is deliberate'],
  },
  {
    keys: [
      { key: "routes", want: "`[]`", holds: (value) => Array.isArray(value) && value.length === 0 },
      { key: "route", want: "no `route` at all", holds: (value) => value === undefined },
    ],
    consequence: "a config silent about `routes` reads identically to one whose routes were deleted by accident",
    detail: [
      'state the routes the Worker serves, or "routes": [] to say it serves none',
      "`route` states it too — wrangler accepts either spelling, but never both",
    ],
    strictDetail: ['state "routes": [] and no `route`, or drop `require: "unroutable"` to say the exposure is deliberate'],
    conflict: { message: "wrangler accepts exactly one", detail: ["delete one — `routes` for a list of patterns, `route` for a single one"] },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value as a reader sees it, capped so one long `routes` array cannot own the line. */
function describe(block: Record<string, unknown>, key: string): string {
  if (block[key] === undefined) return "absent";
  const json = JSON.stringify(block[key]);
  return `\`${json.length > 48 ? `${json.slice(0, 47)}…` : json}\``;
}

/** Every finding one deployment block owes, and whether each control was settled. */
function judgeBlock(block: Record<string, unknown>, prefix: string, posture: ExposurePosture, file: string): { findings: Finding[]; held: number } {
  const findings: Finding[] = [];
  let held = 0;

  for (const control of CONTROLS) {
    const stated = control.keys.filter((entry) => block[entry.key] !== undefined);

    if (stated.length > 1 && control.conflict !== undefined) {
      const names = stated.map((entry) => `\`${prefix}${entry.key}\``).join(" and ");
      findings.push(fail(`${names} are both stated, and ${control.conflict.message}`, { file, detail: [...control.conflict.detail] }));
      continue;
    }

    if (stated.length === 0) {
      const named = control.keys[0].key;
      findings.push(fail(`\`${prefix}${named}\` is unstated, and ${control.consequence}`, { file, detail: [...control.detail] }));
      continue;
    }

    // The value rule runs only on a control statedness let through, so an absent `workers_dev` is
    // reported once — as unstated — rather than again as a value the strict posture refuses.
    const wrong = posture === "unroutable" ? control.keys.filter((entry) => !entry.holds(block[entry.key])) : [];
    for (const entry of wrong) {
      const actual = describe(block, entry.key);
      findings.push(
        fail(`\`${prefix}${entry.key}\` is ${actual}, and \`require: "unroutable"\` asks for ${entry.want}`, {
          file,
          detail: [...control.strictDetail],
        }),
      );
    }
    if (wrong.length === 0) held += 1;
  }

  return { findings, held };
}

/** Fails on any Worker config key whose default runs toward exposure being unstated, judging the top level and every `env.*` block as its own. */
export async function checkExposure(config: ExposureCheckConfig): Promise<CheckResult> {
  const { root } = config;
  const posture = config.require ?? "stated";
  const workerConfig = config.workerConfig ?? "wrangler.jsonc";
  const workerPath = resolve(root, workerConfig);

  if (!existsSync(workerPath)) {
    return checkResult([fail(`\`${workerConfig}\` not found`, { file: workerConfig })], "deployment exposure: no worker config");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(readFileSync(workerPath, "utf-8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return checkResult([fail(`\`${workerConfig}\` is not parseable: ${message}`, { file: workerConfig })], "deployment exposure: unparseable");
  }

  if (!isRecord(parsed)) {
    return checkResult([fail(`\`${workerConfig}\` does not hold a JSON object`, { file: workerConfig })], "deployment exposure: unreadable");
  }

  const top = judgeBlock(parsed, "", posture, workerConfig);
  const findings: Finding[] = [...top.findings];
  let held = top.held;
  let deployments = 1;

  const environments = parsed.env;
  if (environments !== undefined && !isRecord(environments)) {
    findings.push(fail("`env` is not a table of named environments", { file: workerConfig }));
  } else {
    for (const [name, environment] of Object.entries(environments ?? {})) {
      deployments += 1;
      if (!isRecord(environment)) {
        findings.push(fail(`\`env.${name}\` is not an environment table`, { file: workerConfig }));
        continue;
      }
      const block = judgeBlock(environment, `env.${name}.`, posture, workerConfig);
      findings.push(...block.findings);
      held += block.held;
    }
  }

  const total = deployments * CONTROLS.length;
  const across = deployments === 1 ? "" : ` across ${deployments} deployments`;
  return checkResult(findings, `deployment exposure: ${held}/${total} keys ${posture}${across}`);
}
