import { stripAnsi } from "../term/ansi";
import type { StepResults, TestFailure } from "./types";

const ERROR_MAX = 240;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function firstLine(message: string): string {
  const line =
    stripAnsi(message)
      .split("\n")
      .map((part) => part.trim())
      .find((part) => part !== "") ?? "";
  return line.length > ERROR_MAX ? `${line.slice(0, ERROR_MAX - 1)}…` : line;
}

function errorOf(results: readonly Json[]): string {
  for (const result of results) {
    const error = isObject(result.error) ? result.error : list(result.errors)[0];
    const line = firstLine(text(error?.message));
    if (line !== "") return line;
  }
  return "";
}

function collect(suite: Json, titles: readonly string[], out: { ran: number; failures: TestFailure[] }): void {
  for (const spec of list(suite.specs)) {
    for (const test of list(spec.tests)) {
      const results = list(test.results);
      out.ran += results.length;
      if (test.status !== "unexpected") continue;
      out.failures.push({
        engine: text(test.projectName),
        spec: text(spec.file),
        title: [...titles, text(spec.title)].join(" › "),
        error: errorOf(results),
      });
    }
  }
  for (const child of list(suite.suites)) collect(child, [...titles, text(child.title)], out);
}

/** The failing tests a Playwright JSON report records, or `undefined` when it is unreadable or records no test result — the run never got past `webServer` or `globalSetup`. @internal */
export function readPlaywrightResults(json: string): readonly TestFailure[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isObject(parsed)) return undefined;
  const out = { ran: 0, failures: [] as TestFailure[] };
  // A top-level suite is a file, whose title only repeats the spec path.
  for (const file of list(parsed.suites)) collect(file, [], out);
  return out.ran === 0 ? undefined : out.failures;
}

/** The browser rows' results: Playwright's JSON reporter beside the console's `list`. @internal */
export const PLAYWRIGHT_RESULTS: StepResults = { args: ["--reporter=list,json"], env: "PLAYWRIGHT_JSON_OUTPUT_FILE", read: readPlaywrightResults };
