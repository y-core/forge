import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readPlaywrightResults } from "./playwright-results";

// Written by Playwright's own JSON reporter over one spec, run under two projects: in each, `menu › opens` fails an
// `expect`, `menu › closes` passes and `top` throws a two-line error.
const REPORT = readFileSync(fileURLToPath(new URL("../../../tests/fixtures/playwright-json/report.json", import.meta.url)), "utf-8");

describe("readPlaywrightResults()", () => {
  it("names each failing test by engine, spec, describe chain and the first line of its error, colour stripped", () => {
    expect(readPlaywrightResults(REPORT)).toEqual([
      { engine: "chromium", spec: "a.spec.ts", title: "top", error: "Error: boom" },
      { engine: "firefox", spec: "a.spec.ts", title: "top", error: "Error: boom" },
      { engine: "chromium", spec: "a.spec.ts", title: "menu › opens", error: "Error: expect(received).toBe(expected) // Object.is equality" },
      { engine: "firefox", spec: "a.spec.ts", title: "menu › opens", error: "Error: expect(received).toBe(expected) // Object.is equality" },
    ]);
  });

  it("answers no failures for a report whose every test passed", () => {
    const passed = {
      suites: [
        {
          title: "a.spec.ts",
          specs: [{ title: "t", file: "a.spec.ts", tests: [{ projectName: "chromium", status: "expected", results: [{ status: "passed" }] }] }],
        },
      ],
    };

    expect(readPlaywrightResults(JSON.stringify(passed))).toEqual([]);
  });

  it("answers undefined for the report a failed globalSetup leaves, which holds no suite", () => {
    expect(readPlaywrightResults(JSON.stringify({ config: {}, suites: [], errors: [{ message: "Error: server down" }] }))).toBeUndefined();
  });

  it("answers undefined when tests were collected and none produced a result", () => {
    const unrun = {
      suites: [
        { title: "a.spec.ts", specs: [{ title: "t", file: "a.spec.ts", tests: [{ projectName: "chromium", status: "skipped", results: [] }] }] },
      ],
    };

    expect(readPlaywrightResults(JSON.stringify(unrun))).toBeUndefined();
  });

  it("answers undefined for text that is not a JSON object", () => {
    expect([readPlaywrightResults("{"), readPlaywrightResults("[]"), readPlaywrightResults("")]).toEqual([undefined, undefined, undefined]);
  });

  it("bounds an error line at 240 characters, the last one an ellipsis", () => {
    const long = "x".repeat(500);
    const failed = {
      suites: [
        {
          title: "a",
          specs: [{ title: "t", file: "a", tests: [{ projectName: "p", status: "unexpected", results: [{ error: { message: long } }] }] }],
        },
      ],
    };

    expect(readPlaywrightResults(JSON.stringify(failed))?.[0]?.error).toBe(`${"x".repeat(239)}…`);
  });
});
