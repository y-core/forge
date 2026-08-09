import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";

/** The probe is the whole of the `test:browser` prerequisite: the gate reads nothing but its exit
 *  code, so it is exercised here the way the gate exercises it — as a spawned process — rather than
 *  by importing it. Importing would also pull `@playwright/test` into the `bun test` process, which
 *  `.decisions/TESTING.md` §1c keeps the two runners apart to avoid.
 *
 *  Neither case assumes a browser is present. One asserts the probe answers by exit code *alone*;
 *  the other asserts the polarity of that answer against the path playwright itself resolves.
 */
const REPO_ROOT = new URL("../", import.meta.url).pathname;

declare const Bun: {
  spawnSync(opts: { cmd: string[]; cwd: string }): { exitCode: number; stdout: { toString(): string }; stderr: { toString(): string } };
};

function bun(args: string[]) {
  return Bun.spawnSync({ cmd: ["bun", ...args], cwd: REPO_ROOT });
}

describe("scripts/probe-browser.ts", () => {
  let probe: { exitCode: number; stdout: string; stderr: string };
  let executablePath = "";

  beforeAll(() => {
    const child = bun(["run", "scripts/probe-browser.ts"]);
    probe = { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };

    // A second process asks playwright where the browser *would* be. Reading the path rather than
    // re-running the probe's own expression is what lets the polarity assertion below fail when
    // the ternary is inverted.
    const printer = bun(["-e", 'import { chromium } from "@playwright/test"; console.log(chromium.executablePath());']);
    if (printer.exitCode !== 0) throw new Error(`harness failed (exit ${printer.exitCode}): ${printer.stderr.toString()}`);
    executablePath = printer.stdout.toString().trim();
  });

  /** The probe accepts either browser, so the expectation is the disjunction rather than the
   *  download alone — on a host that publishes `CHROME_PATH` the download is absent and a
   *  download-only expectation would demand a 1 the probe is right not to give. */
  const browserOnDisk = () => {
    const fromEnv = process.env.CHROME_PATH;
    return (!!fromEnv && existsSync(fromEnv)) || existsSync(executablePath);
  };

  it("answers by exit code alone, writing nothing to either stream", () => {
    // A crash — a bad import, a throw out of `executablePath()` — also exits non-zero, and would
    // be read by the gate as "the browser is missing; run `bun run test:install`". The empty
    // streams are what separate a verdict from an accident.
    expect(probe.stdout).toBe("");
    expect(probe.stderr).toBe("");
  });

  it("exits 0 when a launchable browser exists and 1 when none does", () => {
    expect(executablePath).not.toBe("");
    expect(probe.exitCode).toBe(browserOnDisk() ? 0 : 1);
  });

  it("accepts the container's baked-in browser, which playwright's own resolution never finds", () => {
    // The regression this file exists to catch: `CHROME_PATH` set and the download absent is the
    // devbox's exact state, and a probe that consulted only `chromium.executablePath()` reported
    // "chromium missing" there — skipping the browser step on a host that could run it.
    const fromEnv = process.env.CHROME_PATH;
    if (!fromEnv || !existsSync(fromEnv)) return; // no baked-in browser here; nothing to assert
    expect(probe.exitCode).toBe(0);
  });
});
