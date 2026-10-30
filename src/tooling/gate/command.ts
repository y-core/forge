import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob, relative, resolve, sep } from "node:path";
import { env, exit } from "node:process";

import { createCommand } from "../cli/command";
import { loadConfigModule } from "../cli/config-module";
import { capture, hasTool, insertPath } from "../cli/proc";
import type { CaptureResult, Command } from "../cli/types";
import { worktreeChanges, worktreeFiles, worktreeHash, worktreeHead } from "../cli/worktree";
import { PLAIN } from "../term/color";
import type { Colorize } from "../term/types";
import { clearReceipt, readReceipt, receiptCovers, recordReceipt } from "./receipt";
import {
  formatFailureExcerpt,
  formatFindingBlock,
  formatFixSummary,
  formatFullLogPath,
  formatLeftInTemp,
  formatList,
  formatMissingRequirement,
  formatNothingAffected,
  formatReceiptWithheld,
  formatReused,
  formatReuseMiss,
  formatStepLine,
  listLabel,
  formatSummary,
  formatUntouched,
} from "./report";
import { failsWhenAbsent, isCheckStep, selectSteps } from "./steps";
import { GATE_TIERS } from "./types";
import type {
  CheckStep,
  CommandStep,
  GateRunReport,
  GateTier,
  Step,
  StepReach,
  StepReport,
  StepRequirement,
  StepResults,
  TestFailure,
} from "./types";
import type { GateCommandConfig } from "./types";

/** Where `forge verify` looks for a step table when `--config` names none. @public */
export const DEFAULT_STEPS_CONFIG = "config/steps.ts";

const DEFAULT_TIER: GateTier = "runtime";

const gateFlags = {
  tier: { type: "string" as const, description: `Which tier to run: ${GATE_TIERS.join(", ")} (default: ${DEFAULT_TIER})` },
  only: {
    type: "string" as const,
    multiple: true as const,
    description: "Run only these steps. Repeatable, and comma-separated lists are accepted",
  },
  list: { type: "boolean" as const, description: "Print the selected steps and exit, running none" },
  fix: { type: "boolean" as const, description: "Run each selected step's fixer instead of the step" },
  reuse: { type: "boolean" as const, description: "Exit green at once when a passing run of this exact tree is on record at this tier or above" },
  affected: { type: "boolean" as const, description: "Run only the steps whose watched paths the working tree's changes touch (a scoped run)" },
  report: { type: "string" as const, description: "Write report.json and every step's whole log into this directory, whatever the verdict" },
};

const binFlags = {
  ...gateFlags,
  config: { type: "string" as const, description: `Step table module, default-exporting readonly Step[] (default: ${DEFAULT_STEPS_CONFIG})` },
  root: { type: "string" as const, description: "Repository root every step runs in (default: the working directory)" },
};

// `test:browser` carries a colon, which is not a portable filename character.
function logName(label: string): string {
  return `${label.replace(/[^a-z0-9]+/gi, "-")}.log`;
}

// A filesystem refusal is swallowed: the gate's verdict must be reported even when the log cannot
// be written.
function writeFullLog(label: string, output: string, cwd: string): string | undefined {
  try {
    const dir = join(tmpdir(), "forge-gate-logs", createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 12));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, logName(label));
    writeFileSync(file, output, "utf-8");
    return file;
  } catch {
    return undefined;
  }
}

type StepCapture = CaptureResult & { tests?: readonly TestFailure[] | "none" };

// The results file is read and removed before the TMPDIR is listed, so asking for it never trips `leavesNoTemp`.
function readResults(results: StepResults, file: string): readonly TestFailure[] | "none" {
  if (!existsSync(file)) return "none";
  const text = readFileSync(file, "utf-8");
  rmSync(file, { force: true });
  return results.read(text) ?? "none";
}

// One TMPDIR per step, removed when it exits.
function captureStep(
  bin: string,
  args: string[],
  cwd: string,
  step: Pick<CommandStep, "leavesNoTemp" | "tempCaches">,
  results?: StepResults,
): StepCapture {
  const dir = mkdtempSync(join(tmpdir(), "forge-step-"));
  try {
    const file = join(dir, "forge-results.json");
    const asked = results === undefined ? args : [...args, ...results.args];
    const stepEnv = results === undefined ? { ...env, TMPDIR: dir } : { ...env, TMPDIR: dir, [results.env]: file };
    const captured = capture(bin, asked, { cwd, env: stepEnv });
    const result: StepCapture = results === undefined ? captured : { ...captured, tests: readResults(results, file) };
    const kept = step.tempCaches ?? [];
    const left =
      step.leavesNoTemp === true
        ? readdirSync(dir)
            .filter((entry) => !kept.some((glob) => matchesGlob(entry, glob)))
            .sort()
        : [];
    if (left.length === 0) return result;
    return { ...result, code: result.code === 0 ? 1 : result.code, output: `${result.output}\n${formatLeftInTemp(left)}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Asked once per tool per run, because `hasTool` shells out and several steps name the same one.
// What an absent dependency means is the tier's answer: no runtime is promised below `runtime`.
async function absentRequirement(step: Step, probed: Map<string, boolean>): Promise<StepRequirement | undefined> {
  const required = step.requires;
  if (required === undefined) return undefined;
  const cached = probed.get(required.tool);
  const present = cached ?? (required.probe === undefined ? hasTool(required.tool) : await required.probe());
  probed.set(required.tool, present);
  return present ? undefined : required;
}

function decidesLate(step: Step, reach: StepReach | undefined): boolean {
  return reach === "narrow" && (step.widen !== undefined || step.narrow?.probe !== undefined);
}

async function widenedBy(step: Step, pending: readonly string[], cwd: string): Promise<boolean> {
  const widen = step.widen;
  if (widen === undefined || pending.length === 0) return false;
  try {
    const paths = new Set(await widen(cwd));
    return pending.some((path) => paths.has(path));
  } catch {
    return true;
  }
}

async function settleReach(
  steps: readonly Step[],
  reach: Readonly<Record<string, StepReach>>,
  pending: readonly string[],
  cwd: string,
): Promise<{ reach: Record<string, StepReach>; probes: Record<string, string> }> {
  const settled: Record<string, StepReach> = { ...reach };
  const probes: Record<string, string> = {};
  for (const step of steps) {
    const before = reach[step.label];
    if (before !== "narrow" && before !== "untouched") continue;
    if (await widenedBy(step, pending, cwd)) {
      settled[step.label] = "whole";
      continue;
    }
    const probe = step.narrow?.probe;
    if (before !== "narrow" || isCheckStep(step) || probe === undefined) continue;
    const [bin, ...args] = step.cmd;
    const asked = [...args, ...(step.narrow?.args ?? []), ...probe.args];
    const result = captureStep(bin, asked, cwd, {});
    if (result.code !== 0) settled[step.label] = "whole";
    else if (!probe.selects(result.output)) {
      settled[step.label] = "untouched";
      probes[step.label] = [bin, ...asked].join(" ");
    }
  }
  return { reach: settled, probes };
}

function resolveTier(flag: string | undefined): { ok: true; tier: GateTier } | { ok: false; error: string } {
  if (flag === undefined) return { ok: true, tier: DEFAULT_TIER };
  const named = GATE_TIERS.find((candidate) => candidate === flag);
  if (named === undefined) return { ok: false, error: `Unknown --tier: "${flag}". Known tiers: ${GATE_TIERS.join(", ")}.` };
  return { ok: true, tier: named };
}

function reportFailure(label: string, output: string, tail: number, cwd: string): void {
  console.log(formatFailureExcerpt(output, tail));
  const path = writeFullLog(label, output, cwd);
  if (path !== undefined) console.log(formatFullLogPath(path));
}

// A check that throws is a defect in the check, not a verdict — but the gate still owes a summary
// line, so the throw is reported as that step's failure rather than unwinding the whole run.
async function runCheck(step: CheckStep, tier: GateTier, style: Colorize): Promise<{ ok: boolean; ms: number; report: string; plain: string }> {
  const started = Date.now();
  try {
    const result = await step.run(tier);
    return {
      ok: result.ok,
      ms: Date.now() - started,
      report: formatFindingBlock(result.findings, style),
      plain: formatFindingBlock(result.findings, PLAIN),
    };
  } catch (error) {
    const thrown = `    ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, ms: Date.now() - started, report: thrown, plain: thrown };
  }
}

function commandStatus(result: StepCapture): Pick<StepReport, "status" | "failures"> {
  if (result.code === 0) return { status: "passed" };
  if (result.tests === "none") return { status: "setup" };
  return result.tests === undefined || result.tests.length === 0 ? { status: "failed" } : { status: "failed", failures: result.tests };
}

// Unlike the TMPDIR copy, a log the report names must exist, so a refusal here is the run's failure.
function writeReportLog(dir: string, label: string, output: string): string {
  const name = logName(label);
  writeFileSync(join(dir, name), output, "utf-8");
  return name;
}

function optional<K extends string>(key: K, value: string | undefined): Record<K, string> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

/** Builds the `verify` command over a project's step table. @public */
export function createGateCommand(config: GateCommandConfig): Command<typeof gateFlags> {
  const { cwd, steps: table, binDir = `${cwd}/node_modules/.bin`, gateInputs, receipt: keepsReceipt = true } = config;

  return createCommand({
    name: "verify",
    description: `Run the verification gate (--tier ${GATE_TIERS.join("|")}; default ${DEFAULT_TIER})`,
    flags: gateFlags,
    args: { kind: "none" },
    async run(_args, flags, ctx) {
      // The gate writes its progress to stdout, so it is stdout's level that decides. Redirect it
      // and the ticks go plain; leave it attached and they are coloured, whatever stderr is doing.
      const style = ctx?.out ?? PLAIN;
      // Annotated: TS narrows past a never-returning call only through an explicitly typed callee.
      const quit: (code: number) => never = ctx?.io.exit ?? exit;
      const resolved = resolveTier(flags.tier);
      if (!resolved.ok) {
        console.error(resolved.error);
        quit(1);
      }
      const { tier } = resolved;
      if (flags.report !== undefined) {
        const clash = [
          flags.fix === true && "fix",
          flags.list === true && "list",
          flags.reuse === true && "reuse",
          flags.affected === true && "affected",
        ].find((name) => name !== false);
        if (clash !== undefined) {
          console.error(`--report records the steps a run executes, so it takes no --${clash}.`);
          quit(1);
        }
      }
      if (flags.reuse === true) {
        const clash = [
          (flags.only?.length ?? 0) > 0 && "only",
          flags.fix === true && "fix",
          flags.list === true && "list",
          flags.affected === true && "affected",
        ].find((name) => name !== false);
        if (clash !== undefined) {
          console.error(`--reuse stands in for a whole gate run, so it takes no --${clash}.`);
          quit(1);
        }
      }
      // The tier belongs in the verdict: `✓ verify` and `✓ verify --tier release` are different assurances.
      const affected = flags.affected === true;
      const banner = ["verify", ...(tier === DEFAULT_TIER ? [] : ["--tier", tier]), ...(affected ? ["--affected"] : [])].join(" ");

      const pending = affected || tier === "runtime" ? worktreeChanges(cwd) : undefined;
      const changed = affected ? pending : undefined;
      if (affected && changed === undefined) {
        console.error("--affected reads its changes from git, and this is not a git work tree.");
        quit(1);
      }

      const files = worktreeFiles(cwd);
      const selection = selectSteps(table, {
        tier,
        ...(flags.only === undefined ? {} : { only: flags.only }),
        ...(changed === undefined ? {} : { changed }),
        ...(pending === undefined ? {} : { pending }),
        ...(gateInputs === undefined ? {} : { gateInputs }),
        ...(files === undefined ? {} : { files }),
      });
      if (!selection.ok) {
        console.error(selection.error);
        quit(1);
      }

      const { steps, total, scoped } = selection;
      insertPath(binDir);
      const settle = async (): Promise<{ reach: Record<string, StepReach>; probes: Record<string, string> }> =>
        pending === undefined ? { reach: { ...selection.reach }, probes: {} } : settleReach(steps, selection.reach, pending, cwd);

      if (flags.list) {
        const { reach } = await settle();
        console.log(
          formatList(
            banner,
            steps.map((step) => listLabel(step, tier, reach[step.label])),
            { total, scoped },
            style,
          ),
        );
        return;
      }

      if (steps.length === 0) {
        console.log(formatNothingAffected(banner, { changed: changed?.length ?? 0, total }, style));
        return;
      }

      if (flags.fix) {
        let fixed = 0;
        let unfixable = 0;
        let skipped = 0;
        let broke = false;
        const probed = new Map<string, boolean>();
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
          const absent = await absentRequirement(step, probed);
          if (absent !== undefined) {
            console.log(formatMissingRequirement(step.label, absent.tool, absent.hint, tier, style));
            if (failsWhenAbsent(tier)) broke = true;
            else skipped++;
            continue;
          }
          const [bin, ...args] = step.fix;
          const result = captureStep(bin, args, cwd, step);
          console.log(formatStepLine(`fix:${step.label}`, result.code === 0, result.ms, style));
          if (result.code === 0) {
            fixed++;
          } else {
            reportFailure(step.label, result.output, step.tail, cwd);
            broke = true;
          }
        }
        console.log(formatFixSummary({ gate: banner, fixed, unfixable, skipped }));
        if (broke || skipped > 0) quit(1);
        return;
      }

      const unscoped = (flags.only?.length ?? 0) === 0 && !affected;
      const tree = unscoped ? worktreeHash(cwd) : undefined;
      const base = tree === undefined ? undefined : worktreeHead(cwd);
      if (flags.reuse === true) {
        // A receipt of this tree and base settled its late rows over the same changes, so it is not asked to have run them.
        const required = steps
          .filter((step) => selection.reach[step.label] !== "untouched" && !decidesLate(step, selection.reach[step.label]))
          .map((step) => step.label);
        const receipt = tree === undefined ? undefined : readReceipt(cwd);
        if (receipt !== undefined && tree !== undefined && receiptCovers(receipt, { tree, tier, base, labels: required })) {
          console.log(formatReused(banner, receipt, style));
          return;
        }
        console.log(formatReuseMiss({ tree, tier }, style));
      }

      const { reach, probes } = await settle();
      const labels = steps.filter((step) => reach[step.label] !== "untouched").map((step) => step.label);

      const reportDir = flags.report === undefined ? undefined : resolve(cwd, flags.report);
      if (reportDir !== undefined) mkdirSync(reportDir, { recursive: true });
      const records: StepReport[] = [];
      const logged = (label: string, output: string): { log: string } | Record<string, never> =>
        reportDir === undefined ? {} : { log: writeReportLog(reportDir, label, output) };

      const started = Date.now();
      let passed = 0;
      let skipped = 0;
      let failedAt: { label: string; at: number } | undefined;
      const probed = new Map<string, boolean>();

      for (const [index, step] of steps.entries()) {
        if (reach[step.label] === "untouched") {
          console.log(formatUntouched(step.label, pending?.length ?? 0, style, probes[step.label]));
          records.push({ label: step.label, status: "untouched", durationMs: 0 });
          continue;
        }

        const absent = await absentRequirement(step, probed);
        if (absent !== undefined) {
          console.log(formatMissingRequirement(step.label, absent.tool, absent.hint, tier, style));
          if (failsWhenAbsent(tier)) {
            records.push({ label: step.label, status: "setup", durationMs: 0 });
            failedAt = { label: step.label, at: index + 1 };
            break;
          }
          records.push({ label: step.label, status: "skipped", durationMs: 0 });
          skipped++;
          continue;
        }

        if (isCheckStep(step)) {
          const { ok, ms, report, plain } = await runCheck(step, tier, style);
          console.log(formatStepLine(step.label, ok, ms, style));
          // Warnings are worth printing on a pass too — they are the check's only voice.
          if (report !== "") console.log(report);
          records.push({ label: step.label, status: ok ? "passed" : "failed", durationMs: ms, ...logged(step.label, plain) });
          if (!ok) {
            failedAt = { label: step.label, at: index + 1 };
            break;
          }
          passed++;
          continue;
        }

        const [bin, ...args] = step.cmd;
        const narrowed = reach[step.label] === "narrow" ? (step.narrow?.args ?? []) : [];
        const result = captureStep(bin, [...args, ...narrowed], cwd, step, reportDir === undefined ? undefined : step.results);
        console.log(formatStepLine(step.label, result.code === 0, result.ms, style));
        records.push({ label: step.label, durationMs: result.ms, ...commandStatus(result), ...logged(step.label, result.output) });
        if (result.code !== 0) {
          reportFailure(step.label, result.output, step.tail, cwd);
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
            scoped,
            ms: Date.now() - started,
            ...(failedAt !== undefined ? { failedAt } : {}),
          },
          style,
        ),
      );

      const green = failedAt === undefined && passed > 0 && skipped === 0;
      if (reportDir !== undefined) {
        const reached = new Set(records.map((record) => record.label));
        const report: GateRunReport = {
          tier,
          ...(base === undefined ? optional("head", worktreeHead(cwd)) : { head: base }),
          ...(tree === undefined ? optional("tree", worktreeHash(cwd)) : { tree }),
          startedAt: new Date(started).toISOString(),
          durationMs: Date.now() - started,
          verdict: green ? "pass" : "fail",
          steps: [
            ...records,
            ...steps
              .filter((step) => !reached.has(step.label))
              .map((step): StepReport => ({ label: step.label, status: "unreached", durationMs: 0 })),
          ],
        };
        writeFileSync(join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
      }
      if (unscoped && tree !== undefined && keepsReceipt) {
        if (!green) clearReceipt(cwd);
        else if (worktreeHash(cwd) === tree) recordReceipt(cwd, { tree, tier, ...(base === undefined ? {} : { base }), labels });
        else console.log(formatReceiptWithheld(style));
      }

      if (failedAt !== undefined || passed === 0 || skipped > 0) quit(1);
    },
  });
}

/** Builds the `forge verify` CLI `Command`, which loads its step table from a config module. @public */
export function createGateBinCommand(): Command<typeof binFlags> {
  return createCommand({
    name: "verify",
    description: "Run the verification gate over the step table a config module default-exports",
    flags: binFlags,
    args: { kind: "none" },
    async run(args, flags, ctx) {
      const quit: (code: number) => never = ctx?.io.exit ?? exit;
      const root = flags.root ?? process.cwd();
      const path = flags.config ?? DEFAULT_STEPS_CONFIG;
      const loaded = await loadConfigModule<readonly Step[]>({ root, path, explicit: flags.config !== undefined, what: "step table" });

      if (loaded === undefined) {
        console.error(`No step table at \`${path}\` — create it, or pass --config to name one elsewhere.`);
        quit(1);
      }

      const declared = loaded.exports.GATE_INPUTS;
      if (declared !== undefined && !(Array.isArray(declared) && declared.every((entry) => typeof entry === "string"))) {
        console.error(`\`${path}\` exports GATE_INPUTS, which must be an array of glob strings.`);
        quit(1);
      }
      const table = relative(root, resolve(root, path)).split(sep).join("/");

      await createGateCommand({
        cwd: root,
        steps: loaded.value,
        gateInputs: [...(declared ?? []), table],
        receipt: table === DEFAULT_STEPS_CONFIG,
      }).run?.(args, flags, ctx);
    },
  });
}
