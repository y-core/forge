import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createContext, Script } from "node:vm";

import { err, ok } from "../../../src/result/result";
import type { Result } from "../../../src/result/types";
import type { RegisteredRule } from "../rules/types";
import type { CorpusSection, StepSummary } from "./data";

/** What a Code Mode query reads: frozen copies, built inside the sandbox so no host object is reachable from it. @public */
export interface QueryData {
  readonly rules: readonly RegisteredRule[];
  readonly corpus: readonly CorpusSection[];
  readonly steps: readonly StepSummary[];
}

/** How long a query may run, its microtasks included, before it is stopped. @public */
export const QUERY_TIMEOUT_MS = 2000;

const DEEP_FREEZE = `const freeze = (value) => { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const key of Object.keys(value)) freeze(value[key]); } return value; };`;

const RUNNER = fileURLToPath(new URL("./query-runner.ts", import.meta.url));

/** How much a query's process may print, stdout and stderr together, before it is stopped — the bound `spawnSync`'s `maxBuffer` held. @public */
export const QUERY_OUTPUT_LIMIT = 256 * 1024 * 1024;

/** Startup allowance on top of the query's own limit, for the process that runs it. */
const SPAWN_GRACE_MS = 5000;

/** Runs `code`, an async arrow over `rules`, `corpus` and `steps`, in a process of its own — so nothing a query does can stop the caller, which keeps answering while it runs — and answers its JSON. @public */
export function runQuery(
  code: string,
  data: QueryData,
  timeoutMs = QUERY_TIMEOUT_MS,
  outputLimit = QUERY_OUTPUT_LIMIT,
): Promise<Result<string, string>> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER], {});
    let stdout = "";
    let stderr = "";
    let stopped: string | undefined;
    let printed = 0;
    // Counted in decoded characters across both streams, so a query cannot make the caller hold more than the limit.
    const take = (chunk: string): boolean => {
      printed += chunk.length;
      if (printed <= outputLimit) return true;
      if (stopped === undefined) {
        stopped = `its output passed ${String(outputLimit)} characters`;
        child.kill("SIGKILL");
      }
      return false;
    };
    const timer = setTimeout(() => {
      stopped = `ran past ${String(timeoutMs + SPAWN_GRACE_MS)}ms`;
      child.kill("SIGKILL");
    }, timeoutMs + SPAWN_GRACE_MS);
    child.stdout.setEncoding("utf-8").on("data", (chunk) => {
      if (take(chunk)) stdout += chunk;
    });
    child.stderr.setEncoding("utf-8").on("data", (chunk) => {
      if (take(chunk)) stderr += chunk;
    });
    child.on("error", (error) => {
      stopped ??= error.message;
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (stopped !== undefined) return resolve(err(`the query was stopped — ${stopped}`));
      resolve(answerOf(stdout, stderr, status));
    });
    // A child that died before reading its input closes the pipe; that is reported by `close`, not thrown here.
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ code, data, timeoutMs }));
  });
}

function answerOf(stdout: string, stderr: string, status: number | null): Result<string, string> {
  try {
    const answer = JSON.parse(stdout) as { ok: boolean; data?: unknown; error?: unknown };
    if (answer.ok && typeof answer.data === "string") return ok(answer.data);
    if (!answer.ok && typeof answer.error === "string") return err(answer.error);
  } catch {
    // An unreadable answer is the process's failure, reported below.
  }
  return err(`the query's process exited ${String(status)} without an answer${stderr ? ` — ${stderr.trim().split("\n")[0]}` : ""}`);
}

/** Evaluates a query in this process's own sandbox; `runQuery` calls it from a child process, which is what contains a crash. @internal */
export function evaluateQuery(code: string, data: QueryData, timeoutMs = QUERY_TIMEOUT_MS): Result<string, string> {
  const sandbox = Object.create(null) as Record<string, unknown>;
  // Data properties the query cannot redefine, so neither the result write nor the host's read meets a getter.
  for (const key of ["__out", "__error"]) Object.defineProperty(sandbox, key, { value: undefined, writable: true, configurable: false });
  const context = createContext(sandbox, { codeGeneration: { strings: false, wasm: false }, microtaskMode: "afterEvaluate" });
  sandbox.__data = JSON.stringify(data);
  let script: Script;
  try {
    script = new Script(
      `"use strict"; { ${DEEP_FREEZE} const { rules, corpus, steps } = freeze(JSON.parse(globalThis.__data)); delete globalThis.__data;
      Promise.resolve().then(() => (${code})()).then(
        (value) => { try { globalThis.__out = JSON.stringify(value === undefined ? null : value); } catch (error) { try { globalThis.__error = String(error); } catch {} } },
        (error) => { try { globalThis.__error = String(error); } catch { try { globalThis.__error = "a value that cannot be printed"; } catch {} } },
      ).catch(() => {}); }`,
      { filename: "warden_query" },
    );
  } catch (error) {
    return err(`the query does not parse — ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    script.runInContext(context, { timeout: timeoutMs });
  } catch (error) {
    return err(`the query failed — ${error instanceof Error ? error.message : String(error)}`);
  }
  const thrown = settled(sandbox, "__error");
  if (thrown !== undefined) return err(`the query threw — ${thrown}`);
  const out = settled(sandbox, "__out");
  if (out === undefined) return err("the query never settled — it awaited something that cannot resolve here, where there is no I/O and no timer");
  return ok(out);
}

function settled(sandbox: Record<string, unknown>, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(sandbox, key);
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : undefined;
}
