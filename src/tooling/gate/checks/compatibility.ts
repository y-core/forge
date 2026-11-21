import { listDeployments } from "../../cf/config/environment";
import type { WranglerDeployment } from "../../cf/config/types";
import { checkResult, fail, scannedNothing } from "../finding";
import type { CheckResult, Finding } from "../types";
import type { CompatibilityCheckConfig } from "./types";
import { readWorkerConfig } from "./worker-config";

/** Forge's own posture: the pure Workers/V8 surface, plus the module registry's semantics. */
const REQUIRED_FLAGS = ["no_nodejs_compat", "no_nodejs_compat_v2", "new_module_registry"] as const;

/** The flag a `no_*` requirement refuses, so the contradiction set needs no second list to declare it. */
function refused(flag: string): string | undefined {
  return flag.startsWith("no_") ? flag.slice(3) : undefined;
}

function quoteAll(flags: readonly string[]): string {
  return flags.map((flag) => JSON.stringify(flag)).join(", ");
}

/** Every finding one deployment block owes, and how many of the required flags it holds. */
function judgeBlock(block: WranglerDeployment, prefix: string, required: readonly string[], file: string): { findings: Finding[]; held: number } {
  const key = `\`${prefix}compatibility_flags\``;
  const stated = block.compatibility_flags;

  if (stated === undefined) {
    const message = `${key} is unstated, and an unstated flag set leaves the Worker on whatever its compatibility date defaults to`;
    return { findings: [fail(message, { file, detail: [`state "compatibility_flags": [${quoteAll(required)}]`] })], held: 0 };
  }

  const findings: Finding[] = [];
  let held = 0;

  for (const flag of required) {
    const contradiction = refused(flag);
    if (contradiction !== undefined && stated.includes(contradiction)) {
      findings.push(
        fail(`${key} states \`${contradiction}\`, which contradicts the required \`${flag}\``, {
          file,
          detail: [`delete "${contradiction}" — a forge app runs the pure Workers/V8 surface, and a Node built-in is refused rather than shimmed`],
        }),
      );
      continue;
    }
    if (!stated.includes(flag)) {
      findings.push(fail(`${key} omits \`${flag}\``, { file, detail: [`add "${flag}" — the check asks for at least ${quoteAll(required)}`] }));
      continue;
    }
    held += 1;
  }

  return { findings, held };
}

/** Every finding one Worker config owes, how many required flags it holds, and how many deployments wrangler builds from it. */
function judgeConfig(
  root: string,
  file: string,
  required: readonly string[],
): { findings: Finding[]; held: number; deployments: number } | CheckResult {
  const read = readWorkerConfig(root, file, "compatibility flags");
  if (!("config" in read)) return read;

  const deployments = listDeployments(read.config);
  const findings: Finding[] = [];
  let held = 0;
  let topHeld = 0;

  for (const deployment of deployments) {
    if (deployment.inherited.has("compatibility_flags")) {
      held += topHeld;
      continue;
    }
    const verdict = judgeBlock(deployment.effective, deployment.prefix, required, file);
    if (deployment.env === null) topHeld = verdict.held;
    findings.push(...verdict.findings);
    held += verdict.held;
  }

  return { findings, held, deployments: deployments.length };
}

/** Fails a Worker config whose flag set omits or contradicts the posture every forge app inherits, judging every deployment of every config as wrangler builds it. */
export async function checkCompatibility(config: CompatibilityCheckConfig): Promise<CheckResult> {
  const { root } = config;
  const required = config.require ?? REQUIRED_FLAGS;
  const files = config.workerConfigs ?? ["wrangler.jsonc"];
  if (files.length === 0) return scannedNothing("`workerConfigs` names no Worker config", "compatibility", "judged");
  const findings: Finding[] = [];
  let held = 0;
  let deployments = 0;
  let unread = 0;

  for (const file of files) {
    const verdict = judgeConfig(root, file, required);
    if (!("held" in verdict)) {
      if (files.length === 1) return verdict;
      findings.push(...verdict.findings);
      unread += 1;
      continue;
    }
    findings.push(...verdict.findings);
    held += verdict.held;
    deployments += verdict.deployments;
  }

  const total = deployments * required.length;
  const across = deployments === 1 ? "" : ` across ${deployments} deployments`;
  const configs = files.length === 1 ? "" : ` in ${files.length} configs`;
  const missing = unread === 0 ? "" : `, ${unread} unreadable`;
  return checkResult(findings, `compatibility flags: ${held}/${total} required stated${across}${configs}${missing}`);
}
