import { beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { runConsumerCoverage } from "./coverage";

const SPEC = "tests/unit/coverage.test.tsx";

const order: string[] = [];
const sync = mock((_root: string): void => {
  order.push("sync");
});
const runSpec = mock((_cwd: string, _spec: string): number | null => {
  order.push("runSpec");
  return 0;
});
const deps = { sync, runSpec };

/** A throwaway consumer checkout, optionally holding the spec and a package.json naming it. */
function consumer(options: { spec?: boolean; name?: string } = {}): string {
  const checkout = mkdtempSync(join(tmpdir(), "forge-coverage-"));
  if (options.spec ?? true) {
    mkdirSync(join(checkout, "tests", "unit"), { recursive: true });
    writeFileSync(join(checkout, SPEC), "", "utf-8");
  }
  if (options.name) writeFileSync(join(checkout, "package.json"), JSON.stringify({ name: options.name }), "utf-8");
  return checkout;
}

/** The notice the task's criterion asks for: where the pack landed and the command that restores the pin. */
function overwritten(checkout: string): string {
  return `${join(checkout, "node_modules/@y-core/forge")} now holds this checkout's pack, not its pinned release — \`bun i\` in ${checkout} restores the pin.`;
}

describe("runConsumerCoverage()", () => {
  beforeEach(() => {
    order.length = 0;
    sync.mockClear();
    runSpec.mockClear();
    sync.mockImplementation(() => {
      order.push("sync");
    });
    runSpec.mockImplementation(() => {
      order.push("runSpec");
      return 0;
    });
  });

  it("refuses a missing checkout by its path before touching anything", () => {
    const checkout = join(tmpdir(), "forge-coverage-absent", "starter");
    expect(() => runConsumerCoverage({ checkout, spec: SPEC }, deps)).toThrow(
      `no consumer checkout at ${checkout} — the release gate runs ${SPEC} there against this checkout's packed tarball; clone the demonstrator to that path`,
    );
    expect(sync).not.toHaveBeenCalled();
    expect(runSpec).not.toHaveBeenCalled();
  });

  it("names the checkout-relative spec path when the spec has moved, and never syncs", () => {
    const checkout = consumer({ spec: false });
    expect(() => runConsumerCoverage({ checkout, spec: SPEC }, deps)).toThrow(
      `${checkout}/${SPEC} does not exist — the consumer's coverage spec has moved; update the path in package.json's release:gate script`,
    );
    expect(sync).not.toHaveBeenCalled();
  });

  it("syncs the checkout before running the spec in it", () => {
    const checkout = consumer();
    runConsumerCoverage({ checkout, spec: SPEC }, deps);
    expect(order).toEqual(["sync", "runSpec"]);
    expect(sync.mock.calls).toEqual([[checkout]]);
    expect(runSpec.mock.calls).toEqual([[checkout, SPEC]]);
  });

  it("answers the pass line, stating that the consumer's install now holds this checkout's pack", () => {
    const checkout = consumer();
    expect(runConsumerCoverage({ checkout, spec: SPEC }, deps)).toBe(
      `${SPEC} passed in ${checkout} against this checkout's packed tarball. ${overwritten(checkout)}`,
    );
  });

  it("states the overwritten install on a failing spec too", () => {
    const checkout = consumer({ name: "demo-consumer" });
    runSpec.mockImplementation(() => 1);
    expect(() => runConsumerCoverage({ checkout, spec: SPEC }, deps)).toThrow(overwritten(checkout));
  });

  it("states the overwritten install when the spec could not be run", () => {
    const checkout = consumer();
    runSpec.mockImplementation(() => null);
    expect(() => runConsumerCoverage({ checkout, spec: SPEC }, deps)).toThrow(
      `could not run \`bun test\` in ${checkout}. ${overwritten(checkout)}`,
    );
  });

  it("names the owing repository by its package name and path when the spec fails", () => {
    const checkout = consumer({ name: "demo-consumer" });
    runSpec.mockImplementation(() => 1);
    expect(() => runConsumerCoverage({ checkout, spec: SPEC }, deps)).toThrow(`${SPEC} failed in demo-consumer (${checkout})`);
  });

  it("falls back to the checkout's directory name when it carries no package.json", () => {
    const checkout = consumer();
    runSpec.mockImplementation(() => 1);
    expect(() => runConsumerCoverage({ checkout, spec: SPEC }, deps)).toThrow(`${SPEC} failed in ${basename(checkout)} (${checkout})`);
  });

  it("reports a spec that could not be run apart from one that failed", () => {
    const checkout = consumer();
    runSpec.mockImplementation(() => null);
    expect(() => runConsumerCoverage({ checkout, spec: SPEC }, deps)).toThrow(`could not run \`bun test\` in ${checkout}`);
  });

  it("lets a sync failure through unchanged and runs no spec against a half-synced tree", () => {
    const checkout = consumer();
    const failure = new Error("pack refused");
    sync.mockImplementation(() => {
      throw failure;
    });
    expect(() => runConsumerCoverage({ checkout, spec: SPEC }, deps)).toThrow(failure);
    expect(runSpec).not.toHaveBeenCalled();
  });
});
