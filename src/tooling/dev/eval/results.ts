import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { step } from "./scaffold";
import type { EvalEnv, RoundFile, SessionMode, TaskResult } from "./types";

const ROUND = /^[a-z0-9][a-z0-9-]*$/;

/** Refuses a round name that is not safe as a file and directory name. */
export function assertRoundName(round: string): void {
  if (!ROUND.test(round)) throw new Error(`round ${JSON.stringify(round)} must be lowercase letters, digits and \`-\``);
}

/** Where a round's results are written. */
export function roundPath(env: EvalEnv, round: string): string {
  assertRoundName(round);
  return join(env.evalsDir, "results", `${round}.json`);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

/** Serialises a round with every object's keys sorted, so equal results are equal bytes. */
export function serializeRound(round: RoundFile): string {
  return JSON.stringify(sortKeys(round), null, 2) + "\n";
}

/** Reads a round file, refusing one whose schema this harness does not write. */
export function readRound(path: string): RoundFile {
  if (!existsSync(path)) throw new Error(`no round file at ${path}`);
  const round = JSON.parse(readFileSync(path, "utf-8")) as RoundFile;
  if (round.schema !== 2) throw new Error(`${path} is schema ${String(round.schema)}, and this harness reads schema 2`);
  return round;
}

function codeModeName(codeMode: boolean | undefined): string {
  if (codeMode === undefined) return "unrecorded";
  return codeMode ? "on" : "off";
}

/** Writes one task's results into the round file, keeping the other tasks already there, and formats it with `bun fmt`. */
export function writeTaskResult(
  env: EvalEnv,
  round: string,
  recordedUnder: { forgeSha: string; settingSources: readonly string[]; claudeVersion?: string; mode?: SessionMode; codeMode?: boolean },
  taskId: string,
  result: TaskResult,
): string {
  const { forgeSha } = recordedUnder;
  const settingSources = [...recordedUnder.settingSources];
  const path = roundPath(env, round);
  const existing = existsSync(path) ? readRound(path) : undefined;
  if (existing !== undefined && existing.forgeSha !== forgeSha) {
    throw new Error(`${path} was recorded at ${existing.forgeSha}, not ${forgeSha} — name a new round`);
  }
  const existingSources = existing?.settingSources?.join(",");
  if (existing !== undefined && existingSources !== settingSources.join(",")) {
    throw new Error(
      `${path} was recorded under setting sources ${existingSources ?? "unrecorded"}, not ${settingSources.join(",")} — name a new round`,
    );
  }
  const { claudeVersion } = recordedUnder;
  if (existing !== undefined && existing.claudeVersion !== claudeVersion) {
    throw new Error(
      `${path} was recorded under ${existing.claudeVersion ?? "an unrecorded claude"}, not ${claudeVersion ?? "an unrecorded claude"} — name a new round`,
    );
  }
  const { mode, codeMode } = recordedUnder;
  if (existing !== undefined && existing.mode !== mode) {
    throw new Error(`${path} was recorded in ${existing.mode ?? "an unrecorded"} mode, not ${mode ?? "an unrecorded"} mode — name a new round`);
  }
  if (existing !== undefined && existing.codeMode !== codeMode) {
    throw new Error(`${path} was recorded with Code Mode ${codeModeName(existing.codeMode)}, not ${codeModeName(codeMode)} — name a new round`);
  }
  const file: RoundFile = {
    schema: 2,
    round,
    forgeSha,
    settingSources,
    ...(claudeVersion === undefined ? {} : { claudeVersion }),
    ...(mode === undefined ? {} : { mode }),
    ...(codeMode === undefined ? {} : { codeMode }),
    tasks: { ...existing?.tasks, [taskId]: result },
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeRound(file), "utf-8");
  step("bun", ["fmt", "--no-script", path], env.checkout, env.spawn);
  return path;
}
