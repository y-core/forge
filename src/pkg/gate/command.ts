import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exit } from "node:process";
import { createCommand } from "../../cli/command";
import { capture, hasTool, insertPath } from "../../cli/proc";
import type { Command } from "../../cli/types";
import { loadConfigModule } from "../internal/config-module";
import {
  formatFailureExcerpt,
  formatFindingBlock,
  formatFixSummary,
  formatFullLogPath,
  formatList,
  formatMissingRequirement,
  formatStepLine,
  formatSummary,
} from "./report";
import { type CheckStep, isCheckStep, type Step, selectSteps } from "./steps";

/** Where `forge-verify` looks for a step table when `--config` names none. @public */
export const DEFAULT_STEPS_CONFIG = "config/steps.ts";

const gateFlags = {
  full: { type: "boolean" as const, description: "Also run the steps that may require a machine prerequisite" },
  only: { type: "string" as const, description: "Run only these steps (comma-separated labels)" },
  list: { type: "boolean" as const, description: "Print the selected steps and exit, running none" },
  fix: { type: "boolean" as const, description: "Run each selected step's fixer instead of the step" },
};

const binFlags = {
  ...gateFlags,
  config: { type: "string" as const, description: `Step table module, default-exporting readonly Step[] (default: ${DEFAULT_STEPS_CONFIG})` },
  root: { type: "string" as const, description: "Repository root every step runs in (default: the working directory)" },
};

/** What the runner needs to know about the project it is gating. @public */
export interface GateCommandConfig {
  /** Repository root. Every step is spawned here, so a step's relative paths resolve. */
  cwd: string;
  /** The table to resolve against — the project's own steps. */
  steps: readonly Step[];
  /** Prepended to `PATH` so bare tool names resolve. Defaults to `${cwd}/node_modules/.bin`. */
  binDir?: string;
}

// A filesystem refusal is swallowed: the gate's verdict must be reported even when the log cannot
// be written.
function writeFullLog(label: string, output: string): string | undefined {
  try {
    const dir = mkdtempSync(join(tmpdir(), "forge-gate-"));
    // `test:browser` carries a colon, which is not a portable filename character.
    const file = join(dir, `${label.replace(/[^a-z0-9]+/gi, "-")}.log`);
    writeFileSync(file, output, "utf-8");
    return file;
  } catch {
    return undefined;
  }
}

function reportFailure(label: string, output: string, tail: number): void {
  console.log(formatFailureExcerpt(output, tail));
  const path = writeFullLog(label, output);
  if (path !== undefined) console.log(formatFullLogPath(path));
}

// A check that throws is a defect in the check, not a verdict — but the gate still owes a summary
// line, so the throw is reported as that step's failure rather than unwinding the whole run.
async function runCheck(step: CheckStep): Promise<{ ok: boolean; ms: number; report: string }> {
  const started = Date.now();
  try {
    const result = await step.run();
    return { ok: result.ok, ms: Date.now() - started, report: formatFindingBlock(result.findings) };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, report: `    ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Builds the `verify` command over a project's step table. @public */
export function createGateCommand(config: GateCommandConfig): Command<typeof gateFlags> {
  const { cwd, steps: table, binDir = `${cwd}/node_modules/.bin` } = config;

  return createCommand({
    name: "verify",
    description: "Run the verification gate (--full adds the steps needing a machine prerequisite)",
    flags: gateFlags,
    args: { kind: "none" },
    async run(_args, flags) {
      const mode = flags.full ? "full" : "fast";
      // The mode belongs in the verdict: `✓ verify` and `✓ verify --full` are different assurances.
      const banner = flags.full ? "verify --full" : "verify";

      const selection = selectSteps(table, { mode, ...(flags.only !== undefined ? { only: flags.only } : {}) });
      if (!selection.ok) {
        console.error(selection.error);
        exit(1);
      }

      const { steps, total } = selection;

      if (flags.list) {
        console.log(
          formatList(
            banner,
            steps.map((step) => step.label),
            total,
          ),
        );
        return;
      }

      insertPath(binDir);

      if (flags.fix) {
        let fixed = 0;
        let skipped = 0;
        let broke = false;
        for (const step of steps) {
          if (isCheckStep(step) || step.fix === undefined) {
            skipped++;
            continue;
          }
          const [bin, ...args] = step.fix;
          const result = capture(bin, args, { cwd });
          console.log(formatStepLine(`fix:${step.label}`, result.code === 0, result.ms));
          if (result.code === 0) {
            fixed++;
          } else {
            reportFailure(step.label, result.output, step.tail);
            broke = true;
          }
        }
        console.log(formatFixSummary(banner, fixed, skipped));
        if (broke) exit(1);
        return;
      }

      const started = Date.now();
      let ran = 0;
      let failedAt: string | undefined;

      for (const step of steps) {
        ran++;
        if (step.requires) {
          const { tool, probe, hint } = step.requires;
          if (!(probe === undefined ? hasTool(tool) : probe())) {
            console.log(formatMissingRequirement(step.label, tool, hint));
            failedAt = step.label;
            break;
          }
        }

        if (isCheckStep(step)) {
          const { ok, ms, report } = await runCheck(step);
          console.log(formatStepLine(step.label, ok, ms));
          // Warnings are worth printing on a pass too — they are the check's only voice.
          if (report !== "") console.log(report);
          if (!ok) {
            failedAt = step.label;
            break;
          }
          continue;
        }

        const [bin, ...args] = step.cmd;
        const result = capture(bin, args, { cwd });
        console.log(formatStepLine(step.label, result.code === 0, result.ms));
        if (result.code !== 0) {
          reportFailure(step.label, result.output, step.tail);
          failedAt = step.label;
          break;
        }
      }

      console.log(
        formatSummary({
          gate: banner,
          ran,
          selected: steps.length,
          total,
          ms: Date.now() - started,
          ...(failedAt !== undefined ? { failedAt } : {}),
        }),
      );

      // `execute` only exits by throwing, which would print a spurious `Error:` after the summary.
      if (failedAt !== undefined) exit(1);
    },
  });
}

/** Builds the `forge-verify` CLI `Command`, which loads its table from a config module rather than
 *  being handed one. Delegates to {@link createGateCommand} once the table is resolved. @public */
export function createGateBinCommand(): Command<typeof binFlags> {
  return createCommand({
    name: "forge-verify",
    description: "Run the verification gate over the step table a config module default-exports",
    flags: binFlags,
    args: { kind: "none" },
    async run(args, flags) {
      const root = flags.root ?? process.cwd();
      const path = flags.config ?? DEFAULT_STEPS_CONFIG;
      const steps = await loadConfigModule<readonly Step[]>({ root, path, explicit: flags.config !== undefined, what: "step table" });

      if (steps === undefined) {
        console.error(`No step table at \`${path}\` — create it, or pass --config to name one elsewhere.`);
        exit(1);
      }

      await createGateCommand({ cwd: root, steps }).run?.(args, flags);
    },
  });
}
