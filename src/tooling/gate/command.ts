import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exit } from "node:process";

import { createCommand } from "../cli/command";
import { loadConfigModule } from "../cli/config-module";
import { capture, hasTool, insertPath } from "../cli/proc";
import type { Command } from "../cli/types";
import { PLAIN } from "../term/color";
import type { Colorize } from "../term/types";
import {
  formatFailureExcerpt,
  formatFindingBlock,
  formatFixSummary,
  formatFullLogPath,
  formatList,
  formatMissingRequirement,
  formatStepLine,
  listLabel,
  formatSummary,
} from "./report";
import { GATE_MODES, isCheckStep, selectSteps } from "./steps";
import type { CheckStep, GateMode, Step, StepRequirement } from "./types";
import type { GateCommandConfig } from "./types";

/** Where `forge verify` looks for a step table when `--config` names none. @public */
export const DEFAULT_STEPS_CONFIG = "config/steps.ts";

const gateFlags = {
  mode: { type: "string" as const, description: "Which tier to run: fast, standard or full (default: standard)" },
  full: { type: "boolean" as const, description: "Also run the steps that may require a machine prerequisite" },
  only: {
    type: "string" as const,
    multiple: true as const,
    description: "Run only these steps. Repeatable, and comma-separated lists are accepted",
  },
  list: { type: "boolean" as const, description: "Print the selected steps and exit, running none" },
  fix: { type: "boolean" as const, description: "Run each selected step's fixer instead of the step" },
};

const binFlags = {
  ...gateFlags,
  config: { type: "string" as const, description: `Step table module, default-exporting readonly Step[] (default: ${DEFAULT_STEPS_CONFIG})` },
  root: { type: "string" as const, description: "Repository root every step runs in (default: the working directory)" },
};

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

// The probe is asked once, and what an absent dependency means is the mode's answer, not the step's:
// a fast run has no failure to promise, a full run has no skip to allow.
function absentRequirement(step: Step): StepRequirement | undefined {
  const required = step.requires;
  if (required === undefined) return undefined;
  const present = required.probe === undefined ? hasTool(required.tool) : required.probe();
  return present ? undefined : required;
}

// `--full` is sugar for `--mode full`, so the two together are a contradiction to refuse rather than
// a precedence to invent.
function resolveMode(flags: { mode: string | undefined; full: boolean | undefined }): { ok: true; mode: GateMode } | { ok: false; error: string } {
  if (flags.mode !== undefined && flags.full === true) return { ok: false, error: "Pass --mode or --full, not both." };
  if (flags.full === true) return { ok: true, mode: "full" };
  if (flags.mode === undefined) return { ok: true, mode: "standard" };
  const named = GATE_MODES.find((candidate) => candidate === flags.mode);
  if (named === undefined) return { ok: false, error: `Unknown --mode: "${flags.mode}". Known modes: ${GATE_MODES.join(", ")}.` };
  return { ok: true, mode: named };
}

function reportFailure(label: string, output: string, tail: number): void {
  console.log(formatFailureExcerpt(output, tail));
  const path = writeFullLog(label, output);
  if (path !== undefined) console.log(formatFullLogPath(path));
}

// A check that throws is a defect in the check, not a verdict — but the gate still owes a summary
// line, so the throw is reported as that step's failure rather than unwinding the whole run.
async function runCheck(step: CheckStep, mode: GateMode, style: Colorize): Promise<{ ok: boolean; ms: number; report: string }> {
  const started = Date.now();
  try {
    const result = await step.run(mode);
    return { ok: result.ok, ms: Date.now() - started, report: formatFindingBlock(result.findings, style) };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, report: `    ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Builds the `verify` command over a project's step table. @public */
export function createGateCommand(config: GateCommandConfig): Command<typeof gateFlags> {
  const { cwd, steps: table, binDir = `${cwd}/node_modules/.bin` } = config;

  return createCommand({
    name: "verify",
    description: "Run the verification gate (--mode fast|standard|full; default standard)",
    flags: gateFlags,
    args: { kind: "none" },
    async run(_args, flags, ctx) {
      // The gate writes its progress to stdout, so it is stdout's level that decides. Redirect it
      // and the ticks go plain; leave it attached and they are coloured, whatever stderr is doing.
      const style = ctx?.out ?? PLAIN;
      // Annotated: TS narrows past a never-returning call only through an explicitly typed callee.
      const quit: (code: number) => never = ctx?.io.exit ?? exit;
      const resolved = resolveMode(flags);
      if (!resolved.ok) {
        console.error(resolved.error);
        quit(1);
      }
      const { mode } = resolved;
      // The mode belongs in the verdict: `✓ verify` and `✓ verify --mode full` are different
      // assurances. Named canonically — `--full` is an input spelling, not an output one.
      const banner = mode === "standard" ? "verify" : `verify --mode ${mode}`;

      const selection = selectSteps(table, { mode, ...(flags.only === undefined ? {} : { only: flags.only }) });
      if (!selection.ok) {
        console.error(selection.error);
        quit(1);
      }

      const { steps, total } = selection;

      if (flags.list) {
        console.log(
          formatList(
            banner,
            steps.map((step) => listLabel(step, mode)),
            total,
            style,
          ),
        );
        return;
      }

      insertPath(binDir);

      if (flags.fix) {
        let fixed = 0;
        let unfixable = 0;
        let skipped = 0;
        let broke = false;
        for (const step of steps) {
          // The fixer question comes first: a step with no fixer was never going to spawn, so probing
          // it would report a dependency this run does not need.
          if (step.fix === undefined) {
            unfixable++;
            continue;
          }
          // An in-process fixer spawns nothing, so there is no requirement to probe and no captured
          // output to excerpt: a throw is this step's failure, as it is for `run`.
          if (isCheckStep(step)) {
            const started = Date.now();
            let thrown: string | undefined;
            try {
              await step.fix();
            } catch (error) {
              thrown = error instanceof Error ? error.message : String(error);
            }
            console.log(formatStepLine(`fix:${step.label}`, thrown === undefined, Date.now() - started, style));
            if (thrown === undefined) {
              fixed++;
            } else {
              console.log(`    ${thrown}`);
              broke = true;
            }
            continue;
          }
          const absent = absentRequirement(step);
          if (absent !== undefined) {
            console.log(formatMissingRequirement(step.label, absent.tool, absent.hint, mode, style));
            if (mode === "full") broke = true;
            else skipped++;
            continue;
          }
          const [bin, ...args] = step.fix;
          const result = capture(bin, args, { cwd });
          console.log(formatStepLine(`fix:${step.label}`, result.code === 0, result.ms, style));
          if (result.code === 0) {
            fixed++;
          } else {
            reportFailure(step.label, result.output, step.tail);
            broke = true;
          }
        }
        console.log(formatFixSummary({ gate: banner, fixed, unfixable, skipped }));
        if (broke) quit(1);
        return;
      }

      const started = Date.now();
      let passed = 0;
      let skipped = 0;
      let failedAt: { label: string; at: number } | undefined;

      for (const [index, step] of steps.entries()) {
        const absent = absentRequirement(step);
        if (absent !== undefined) {
          console.log(formatMissingRequirement(step.label, absent.tool, absent.hint, mode, style));
          if (mode === "full") {
            failedAt = { label: step.label, at: index + 1 };
            break;
          }
          skipped++;
          continue;
        }

        if (isCheckStep(step)) {
          const { ok, ms, report } = await runCheck(step, mode, style);
          console.log(formatStepLine(step.label, ok, ms, style));
          // Warnings are worth printing on a pass too — they are the check's only voice.
          if (report !== "") console.log(report);
          if (!ok) {
            failedAt = { label: step.label, at: index + 1 };
            break;
          }
          passed++;
          continue;
        }

        const [bin, ...args] = step.cmd;
        const result = capture(bin, args, { cwd });
        console.log(formatStepLine(step.label, result.code === 0, result.ms, style));
        if (result.code !== 0) {
          reportFailure(step.label, result.output, step.tail);
          failedAt = { label: step.label, at: index + 1 };
          break;
        }
        passed++;
      }

      console.log(
        formatSummary(
          {
            gate: banner,
            passed,
            skipped,
            selected: steps.length,
            total,
            ms: Date.now() - started,
            ...(failedAt !== undefined ? { failedAt } : {}),
          },
          style,
        ),
      );

      // A run whose every step was skipped is red for the reason a zero-step selection is refused.
      // `execute` only exits by throwing, which would print a spurious `Error:` after the summary.
      if (failedAt !== undefined || passed === 0) quit(1);
    },
  });
}

/** Builds the `forge verify` CLI `Command`, which loads its table from a config module rather than
 *  being handed one. Delegates to {@link createGateCommand} once the table is resolved. @public */
export function createGateBinCommand(): Command<typeof binFlags> {
  return createCommand({
    name: "verify",
    description: "Run the verification gate over the step table a config module default-exports",
    flags: binFlags,
    args: { kind: "none" },
    async run(args, flags, ctx) {
      const root = flags.root ?? process.cwd();
      const path = flags.config ?? DEFAULT_STEPS_CONFIG;
      const steps = await loadConfigModule<readonly Step[]>({ root, path, explicit: flags.config !== undefined, what: "step table" });

      if (steps === undefined) {
        console.error(`No step table at \`${path}\` — create it, or pass --config to name one elsewhere.`);
        exit(1);
      }

      await createGateCommand({ cwd: root, steps }).run?.(args, flags, ctx);
    },
  });
}
