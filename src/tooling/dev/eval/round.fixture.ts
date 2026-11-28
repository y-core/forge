import type { CalibrationRecord, RoundFile, RunRecord, SessionMetrics, TaskResult, TrapVerdict } from "./types";

/** Author or reviewer metrics with the given prompt tokens, split across the input and cache fields, and tool calls. */
export function metrics(promptTokens = 1000, toolCalls = 10): SessionMetrics {
  return {
    assistantMessages: 1,
    tokens: { input: promptTokens / 4, cacheCreation: promptTokens / 4, cacheRead: promptTokens / 2, output: 100 },
    toolCalls,
    toolsByName: { Read: toolCalls },
    docReads: {
      warden: { search: 1, read: 2, outline: 0, related: 0, impact: 0 },
      chunks: ["canon:CODE_RULES.md#5a"],
      mdFileReads: 0,
      mdPaths: [],
      wardenCli: 0,
      bashMdReads: 0,
    },
  };
}

/** One run record: accepted, every trap clean, unless overridden. */
export function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    rep: 1,
    timedOut: false,
    author: metrics(),
    review: metrics(),
    invalid: null,
    reviewParseFailed: false,
    findings: 0,
    verifyUnit: true,
    accepted: true,
    traps: { a: "clean", b: "clean" },
    ...overrides,
  };
}

/** One calibration record with the given verdicts, valid unless `invalid` says why not. */
export function calibrationRecord(
  traps: Record<string, TrapVerdict> = { a: "caught", b: "caught" },
  invalid: string | null = null,
): CalibrationRecord {
  return { rep: 1, timedOut: false, review: metrics(), invalid, reviewParseFailed: false, traps };
}

/** A task result of three equal runs and three equal calibrations, unless overridden. */
export function taskResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    specHash: "spec-1",
    model: "opus",
    runs: [runRecord(), runRecord({ rep: 2 }), runRecord({ rep: 3 })],
    calibration: [calibrationRecord(), calibrationRecord(), calibrationRecord()],
    ...overrides,
  };
}

/** A round holding one task, `t`, unless `tasks` says otherwise. */
export function roundFile(round: string, tasks: Record<string, TaskResult> = { t: taskResult() }): RoundFile {
  return { schema: 2, round, forgeSha: "a".repeat(40), settingSources: ["user", "project"], tasks };
}
