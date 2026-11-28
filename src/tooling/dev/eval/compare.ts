import type { RoundComparison, RoundFile, RunRecord, TaskResult, TrapVerdict } from "./types";

const COST_TOLERANCE = 0.15;

const GO_SAVING = 0.15;

const RERUN_BAND = 0.05;

// Billing weights relative to an uncached input token; an assumption about the price list, not read from it.
const BILLED_WEIGHTS = { input: 1, cacheCreation: 1.25, cacheRead: 0.1, output: 5 } as const;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function promptTokens(run: RunRecord): number {
  const { input, cacheCreation, cacheRead } = run.author.tokens;
  return input + cacheCreation + cacheRead;
}

function billedTokens(run: RunRecord): number {
  const { input, cacheCreation, cacheRead, output } = run.author.tokens;
  const w = BILLED_WEIGHTS;
  return input * w.input + cacheCreation * w.cacheCreation + cacheRead * w.cacheRead + output * w.output;
}

function verdictCount(records: readonly { traps: Record<string, TrapVerdict> }[], verdict: TrapVerdict): number {
  return records.reduce((sum, record) => sum + Object.values(record.traps).filter((each) => each === verdict).length, 0);
}

function valid<T extends { invalid: string | null }>(records: readonly T[]): T[] {
  return records.filter((record) => record.invalid === null);
}

interface Figures {
  acceptance: number;
  through: number;
  recall: number;
  tokens: number;
  billed: number;
  toolCalls: number;
  turns: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
}

function figures(result: TaskResult): Figures {
  const valids = valid(result.runs);
  const calibration = valid(result.calibration);
  const runs = Math.max(valids.length, 1);
  const caught = verdictCount(calibration, "caught");
  const fired = caught + verdictCount(calibration, "through");
  return {
    acceptance: valids.filter((run) => run.accepted).length / runs,
    through: verdictCount(valids, "through") / runs,
    recall: fired === 0 ? 1 : caught / fired,
    tokens: median(valids.map(promptTokens)),
    billed: median(valids.map(billedTokens)),
    toolCalls: median(valids.map((run) => run.author.toolCalls)),
    turns: median(valids.map((run) => run.author.assistantMessages)),
    cacheRead: median(valids.map((run) => run.author.tokens.cacheRead)),
    cacheCreation: median(valids.map((run) => run.author.tokens.cacheCreation)),
    output: median(valids.map((run) => run.author.tokens.output)),
  };
}

function exclusions(round: string, result: TaskResult): string[] {
  return [...result.runs, ...result.calibration].flatMap((record) =>
    record.invalid === null ? [] : [`  left out of ${round}: ${record.invalid}`],
  );
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function compareTask(
  id: string,
  rounds: { before: string; after: string },
  before: TaskResult,
  after: TaskResult,
  allowRespec: boolean,
): { lines: string[]; regressed: boolean } {
  const respecced = before.specHash !== after.specHash;
  if (respecced && !allowRespec) return { lines: [`${id}: spec changed between rounds, so it is not comparable — REGRESSED`], regressed: true };
  const a = figures(before);
  const b = figures(after);
  const rows: [string, string, string, boolean][] = [
    ["acceptance", percent(a.acceptance), percent(b.acceptance), b.acceptance < a.acceptance],
    ["through per run", a.through.toFixed(2), b.through.toFixed(2), b.through > a.through],
    ["calibration recall", percent(a.recall), percent(b.recall), b.recall < a.recall],
    ["median prompt tokens", String(a.tokens), String(b.tokens), b.tokens > a.tokens * (1 + COST_TOLERANCE)],
    ["median billed tokens", String(Math.round(a.billed)), String(Math.round(b.billed)), b.billed > a.billed * (1 + COST_TOLERANCE)],
    ["median tool calls", String(a.toolCalls), String(b.toolCalls), b.toolCalls > a.toolCalls * (1 + COST_TOLERANCE)],
    // The breakdown behind the token rows, read beside them; the rows above already decide a regression.
    ["median turns", String(a.turns), String(b.turns), false],
    ["median cache-read tokens", String(a.cacheRead), String(b.cacheRead), false],
    ["median cache-creation tokens", String(a.cacheCreation), String(b.cacheCreation), false],
    ["median output tokens", String(a.output), String(b.output), false],
  ];
  const lines = [`${id}:${respecced ? " (spec changed, compared under --allow-respec)" : ""}`];
  for (const [label, from, to, worse] of rows) lines.push(`  ${label}: ${from} → ${to}${worse ? " — REGRESSED" : ""}`);
  lines.push(...exclusions(rounds.before, before), ...exclusions(rounds.after, after));
  return { lines, regressed: rows.some((row) => row[3]) };
}

function armProblems(id: string, arm: string, result: TaskResult): string[] {
  const invalid = result.runs.filter((run) => run.invalid !== null).length;
  return invalid * 3 > result.runs.length ? [`${id}: ${invalid} of ${result.runs.length} runs invalid with Code Mode ${arm}`] : [];
}

function taskProblems(id: string, off: TaskResult, on: TaskResult): string[] {
  const a = figures(off);
  const b = figures(on);
  return [
    ...(b.acceptance < a.acceptance ? [`${id}: acceptance fell from ${percent(a.acceptance)} to ${percent(b.acceptance)}`] : []),
    ...(b.through > a.through ? [`${id}: through per run rose from ${a.through.toFixed(2)} to ${b.through.toFixed(2)}`] : []),
    ...(b.recall < a.recall ? [`${id}: calibration recall fell from ${percent(a.recall)} to ${percent(b.recall)}`] : []),
    ...armProblems(id, "off", off),
    ...armProblems(id, "on", on),
  ];
}

function codeModeVerdict(before: RoundFile, after: RoundFile): string[] {
  if ((before.codeMode ?? false) === (after.codeMode ?? false)) return [];
  if (before.claudeVersion === undefined || before.claudeVersion !== after.claudeVersion) return [];
  const [off, on] = before.codeMode === true ? [after, before] : [before, after];
  const problems = off.forgeSha === on.forgeSha ? [] : [`the rounds ran at different forge commits`];
  let offBilled = 0;
  let onBilled = 0;
  for (const [id, offResult] of Object.entries(off.tasks).sort(([x], [y]) => x.localeCompare(y))) {
    const onResult = on.tasks[id];
    if (onResult === undefined) continue;
    offBilled += figures(offResult).billed;
    onBilled += figures(onResult).billed;
    problems.push(...taskProblems(id, offResult, onResult));
  }
  const saving = offBilled === 0 ? 0 : 1 - onBilled / offBilled;
  if (saving < GO_SAVING) problems.push(`billed-token saving ${percent(saving)} is under ${percent(GO_SAVING)}`);
  const close = Math.abs(saving - GO_SAVING) <= RERUN_BAND + 1e-9;
  const verdict = problems.length === 0 ? "GO" : "NO-GO";
  const rerun = close ? ` — within ${Math.round(RERUN_BAND * 100)} points of ${percent(GO_SAVING)}, so rerun before deciding` : "";
  return [
    `Code Mode ${verdict}: billed-token saving ${(saving * 100).toFixed(1)}% (${off.round} off → ${on.round} on)${rerun}`,
    ...problems.map((problem) => `  ${problem}`),
  ];
}

/** Compares every task two rounds share, figure by figure, and flags a regression under the rule a re-run is held to. */
export function compareRounds(
  before: RoundFile,
  after: RoundFile,
  options: { allowRespec?: boolean; allowMixedMode?: boolean } = {},
): RoundComparison {
  const modes = { before: before.mode ?? "print", after: after.mode ?? "print" };
  const mixed = modes.before !== modes.after;
  if (mixed && options.allowMixedMode !== true) {
    throw new Error(
      `${before.round} ran in ${modes.before} mode and ${after.round} in ${modes.after} mode, so they are not comparable — pass --allow-mixed-mode to compare them anyway`,
    );
  }
  const header = `${before.round} (${before.forgeSha.slice(0, 12)}) → ${after.round} (${after.forgeSha.slice(0, 12)})`;
  const lines = [mixed ? `${header} (${modes.before} → ${modes.after}, compared under --allow-mixed-mode)` : header];
  let regressed = false;
  for (const id of Object.keys(before.tasks).sort()) {
    const from = before.tasks[id];
    const to = after.tasks[id];
    if (from === undefined) continue;
    if (to === undefined) {
      lines.push(`${id}: missing from ${after.round} — REGRESSED`);
      regressed = true;
      continue;
    }
    const task = compareTask(id, { before: before.round, after: after.round }, from, to, options.allowRespec === true);
    lines.push(...task.lines);
    regressed ||= task.regressed;
  }
  for (const id of Object.keys(after.tasks).sort()) {
    if (before.tasks[id] === undefined) lines.push(`${id}: new in ${after.round}, nothing to compare`);
  }
  lines.push(...codeModeVerdict(before, after), regressed ? "regressed" : "no regression");
  return { lines, regressed };
}
