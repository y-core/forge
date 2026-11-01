import { listDeployments } from "../../cf/config/environment";
import type { WranglerDeployment } from "../../cf/config/types";
import { checkResult, fail } from "../finding";
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

/** Fails a Worker config whose flag set omits or contradicts the posture every forge app inherits, judging every deployment as wrangler builds it. */
export async function checkCompatibility(config: CompatibilityCheckConfig): Promise<CheckResult> {
  const { root } = config;
  const required = config.require ?? REQUIRED_FLAGS;
  const workerConfig = config.workerConfig ?? "wrangler.jsonc";
  const read = readWorkerConfig(root, workerConfig, "compatibility flags");
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
    const verdict = judgeBlock(deployment.effective, deployment.prefix, required, workerConfig);
    if (deployment.env === null) topHeld = verdict.held;
    findings.push(...verdict.findings);
    held += verdict.held;
  }

  const total = deployments.length * required.length;
  const across = deployments.length === 1 ? "" : ` across ${deployments.length} deployments`;
  return checkResult(findings, `compatibility flags: ${held}/${total} required stated${across}`);
}
