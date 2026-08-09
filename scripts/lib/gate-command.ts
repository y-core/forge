/** gate-command.ts — the `check` / `verify` verbs built over the `STEPS` table.
 *
 *  Both gates are the same runner with a different membership filter, so there is one factory.
 *  Everything decidable is decided by `selectSteps` (pure) and rendered by `report` (pure);
 *  what remains here is the untestable rim — spawning, printing, and exiting.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exit } from "node:process";
import type { Command } from "../../src/cli/mod";
import { capture, createCommand, insertPath, probeOk } from "../../src/cli/mod";
import {
  formatFailureExcerpt,
  formatFixSummary,
  formatFullLogPath,
  formatList,
  formatMissingRequirement,
  formatStepLine,
  formatSummary,
} from "./report";
import { type Gate, STEPS, selectSteps } from "./steps";

const gateFlags = {
  only: { type: "string" as const, description: "Run only these steps (comma-separated labels)" },
  list: { type: "boolean" as const, description: "Print the selected steps and exit, running none" },
  fix: { type: "boolean" as const, description: "Run each selected step's fixer instead of the step" },
};

export interface GateCommandConfig {
  /** Repository root. Every step is spawned here, so a step's relative paths resolve. */
  cwd: string;
  /** Which gate's membership to run. */
  gate: Gate;
}

const DESCRIPTIONS: Record<Gate, string> = {
  check: "Run the post-development verification gate",
  verify: "Run the pre-release verification gate (check plus the browser suite)",
};

/** Persist a failing step's untruncated output and return its path, or `undefined` when it could
 *  not be written.
 *
 *  `capture` buffers the whole stream through a temp file and then deletes it, handing back only
 *  the text in memory — so this is the one point where the full stream can be made to outlive the
 *  run. It is written here rather than by returning a path from `capture` because `capture` is
 *  published surface (`src/cli/mod`) and this is a runner-only concern.
 *
 *  A filesystem refusal is swallowed: the gate's verdict is the thing that must always be
 *  reported, and losing the log is the failure mode we already have today. */
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

/** Print a failing step's tail, then the path to the untruncated stream behind it. */
function reportFailure(label: string, output: string, tail: number): void {
  console.log(formatFailureExcerpt(output, tail));
  const path = writeFullLog(label, output);
  if (path !== undefined) console.log(formatFullLogPath(path));
}

/** Build the command for one gate. Mirrors `createReleaseCommand(config)`: config first,
 *  `cwd` inside it, so the thin `scripts/*.ts` binding stays a single `execute` call. */
export function createGateCommand(config: GateCommandConfig): Command<typeof gateFlags> {
  const { cwd, gate } = config;

  return createCommand({
    name: gate,
    description: DESCRIPTIONS[gate],
    flags: gateFlags,
    args: { kind: "none" },
    run(_args, flags) {
      const selection = selectSteps(STEPS, { gate, ...(flags.only !== undefined ? { only: flags.only } : {}) });
      if (!selection.ok) {
        console.error(selection.error);
        exit(1);
      }

      const { steps, total } = selection;

      if (flags.list) {
        console.log(
          formatList(
            gate,
            steps.map((step) => step.label),
            total,
          ),
        );
        return;
      }

      // Steps invoke `tsgo`, `biome`, and `playwright` by bare name; the repo's copies live here.
      insertPath(`${cwd}/node_modules/.bin`);

      if (flags.fix) {
        let fixed = 0;
        let skipped = 0;
        let broke = false;
        for (const step of steps) {
          if (!step.fix) {
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
        console.log(formatFixSummary(gate, fixed, skipped));
        if (broke) exit(1);
        return;
      }

      const started = Date.now();
      let ran = 0;
      let failedAt: string | undefined;

      // Fail-fast: a later step's output is rarely trustworthy once an earlier one has failed,
      // and `typecheck` leads the table precisely because its failures cascade.
      for (const step of steps) {
        ran++;
        if (step.requires) {
          const [probeBin, ...probeArgs] = step.requires.probe ?? [step.requires.tool, "--version"];
          if (!probeOk(probeBin, probeArgs)) {
            console.log(formatMissingRequirement(step.label, step.requires.tool, step.requires.hint));
            failedAt = step.label;
            break;
          }
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
        formatSummary({ gate, ran, selected: steps.length, total, ms: Date.now() - started, ...(failedAt !== undefined ? { failedAt } : {}) }),
      );

      // `execute` only ever exits via a thrown error, which would print a spurious `Error:` line
      // after the summary. Exit directly so `prepublishOnly` still blocks on a red gate.
      if (failedAt !== undefined) exit(1);
    },
  });
}
