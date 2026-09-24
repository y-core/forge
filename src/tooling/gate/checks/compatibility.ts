import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { stripJsonc } from "../../cli/jsonc";
import { checkResult, fail } from "../finding";
import type { CheckResult, Finding } from "../types";
import type { CompatibilityCheckConfig } from "./types";

/** Forge's own posture: the pure Workers/V8 surface, plus the module registry's semantics. */
const REQUIRED_FLAGS = ["no_nodejs_compat", "no_nodejs_compat_v2", "new_module_registry"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The flag a `no_*` requirement refuses, so the contradiction set needs no second list to declare it. */
function refused(flag: string): string | undefined {
  return flag.startsWith("no_") ? flag.slice(3) : undefined;
}

function quoteAll(flags: readonly string[]): string {
  return flags.map((flag) => JSON.stringify(flag)).join(", ");
}

/** Every finding one deployment block owes, and how many of the required flags it holds. */
function judgeBlock(
  block: Record<string, unknown>,
  prefix: string,
  required: readonly string[],
  file: string,
): { findings: Finding[]; held: number } {
  const key = `\`${prefix}compatibility_flags\``;
  const stated = block.compatibility_flags;

  if (stated === undefined) {
    const message = `${key} is unstated, and an unstated flag set leaves the Worker on whatever its compatibility date defaults to`;
    return { findings: [fail(message, { file, detail: [`state "compatibility_flags": [${quoteAll(required)}]`] })], held: 0 };
  }

  if (!Array.isArray(stated) || stated.some((flag) => typeof flag !== "string")) {
    const message = `${key} is not a list of flag names`;
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

/** Fails a Worker config whose flag set omits or contradicts the posture every forge app inherits, judging the top level and every environment that states a set of its own. */
export async function checkCompatibility(config: CompatibilityCheckConfig): Promise<CheckResult> {
  const { root } = config;
  const required = config.require ?? REQUIRED_FLAGS;
  const workerConfig = config.workerConfig ?? "wrangler.jsonc";
  const workerPath = resolve(root, workerConfig);

  if (!existsSync(workerPath)) {
    return checkResult([fail(`\`${workerConfig}\` not found`, { file: workerConfig })], "compatibility flags: no worker config");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(readFileSync(workerPath, "utf-8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return checkResult([fail(`\`${workerConfig}\` is not parseable: ${message}`, { file: workerConfig })], "compatibility flags: unparseable");
  }

  if (!isRecord(parsed)) {
    return checkResult([fail(`\`${workerConfig}\` does not hold a JSON object`, { file: workerConfig })], "compatibility flags: unreadable");
  }

  const top = judgeBlock(parsed, "", required, workerConfig);
  const findings: Finding[] = [...top.findings];
  let held = top.held;
  let deployments = 1;

  const environments = parsed.env;
  if (environments !== undefined && !isRecord(environments)) {
    findings.push(fail("`env` is not a table of named environments", { file: workerConfig }));
  } else {
    for (const [name, environment] of Object.entries(environments ?? {})) {
      if (!isRecord(environment)) {
        findings.push(fail(`\`env.${name}\` is not an environment table`, { file: workerConfig }));
        continue;
      }
      // Unlike the exposure keys, `compatibility_flags` is inherited: an environment silent about it
      // runs the list judged above, and one that states its own replaces that list rather than adding to it.
      if (environment.compatibility_flags === undefined) continue;
      deployments += 1;
      const block = judgeBlock(environment, `env.${name}.`, required, workerConfig);
      findings.push(...block.findings);
      held += block.held;
    }
  }

  const total = deployments * required.length;
  const across = deployments === 1 ? "" : ` across ${deployments} deployments`;
  return checkResult(findings, `compatibility flags: ${held}/${total} required stated${across}`);
}
