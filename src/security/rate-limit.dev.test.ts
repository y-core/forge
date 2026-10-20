import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { skipAbsentLimiter, admitsAbsentLimiter } from "./rate-limit.dev";

let consoleLog: ReturnType<typeof spyOn<Console, "log">> | undefined;

afterEach(() => {
  consoleLog?.mockRestore();
  consoleLog = undefined;
});

const loggedLines = (spy: ReturnType<typeof spyOn<Console, "log">>) =>
  spy.mock.calls
    .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
    .map(({ level, prefix, message }) => ({ level, prefix, message }));

describe("skipAbsentLimiter", () => {
  it("admits the request and warns, under the `rate-limit` logger, that enforcement was skipped", () => {
    consoleLog = spyOn(console, "log").mockImplementation(() => {});

    expect(skipAbsentLimiter()).toBe(true);
    expect(loggedLines(consoleLog)).toEqual([{ level: "warn", prefix: "rate-limit", message: "Rate limiter binding not configured — skipping" }]);
  });
});

describe("admitsAbsentLimiter", () => {
  it("refuses, and warns of no skipped enforcement, in a run that does not arm the development build", () => {
    consoleLog = spyOn(console, "log").mockImplementation(() => {});

    expect({ admitted: admitsAbsentLimiter(), logged: loggedLines(consoleLog) }).toEqual({ admitted: false, logged: [] });
  });
});
