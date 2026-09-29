import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CliContext } from "../cli/types";
import { createReleaseBinCommand } from "../release/release";
import { PLAIN } from "../term/color";
import { createGateBinCommand, createGateCommand, DEFAULT_STEPS_CONFIG } from "./command";
import { worktreeFixture } from "./worktree.fixture";

const GATE = createGateBinCommand();
const RELEASE = createReleaseBinCommand();

describe("createGateBinCommand()", () => {
  it("is named for the bin it backs, since the name is what --help prints", () => {
    expect(GATE.name).toBe("verify");
  });

  it("keeps every flag the handed-a-table command takes, so the bin is not a lesser gate", () => {
    const inner = Object.keys(createGateCommand({ cwd: "/nowhere", steps: [{ label: "x", tail: 1, cmd: ["x"] }] }).flags);

    expect(inner.every((flag) => Object.hasOwn(GATE.flags, flag))).toBe(true);
  });

  it("adds exactly the two flags a config-loading bin needs, and no more", () => {
    const inner = Object.keys(createGateCommand({ cwd: "/nowhere", steps: [{ label: "x", tail: 1, cmd: ["x"] }] }).flags);

    expect(Object.keys(GATE.flags).filter((flag) => !inner.includes(flag))).toEqual(["config", "root"]);
  });

  it("takes no positional argument, so a stray word is refused rather than read as a step", () => {
    expect(GATE.args).toEqual({ kind: "none" });
  });

  it("names the default config path in --config's description, so --help answers where it looks", () => {
    expect(GATE.flags.config.description).toContain(DEFAULT_STEPS_CONFIG);
  });
});

describe("createReleaseBinCommand()", () => {
  it("is named for the bin it backs", () => {
    expect(RELEASE.name).toBe("release");
  });

  it("keeps the optional explicit-version argument the release command accepts", () => {
    expect(RELEASE.args).toEqual({ kind: "range", min: 0, max: 1 });
  });

  it("carries the release flags alongside the two config-loading ones", () => {
    expect(Object.keys(RELEASE.flags).sort()).toEqual([
      "allow-branch",
      "allow-dirty",
      "allow-empty-changelog",
      "allow-semver",
      "allow-unverified",
      "config",
      "dry",
      "root",
    ]);
  });

  it("keeps --dry's short form, which is what a release is most often invoked with", () => {
    expect(RELEASE.flags.dry.short).toBe("n");
  });
});

describe("the two bins agree on how a config module is named", () => {
  it("spells the flags identically, so one habit serves both", () => {
    expect(GATE.flags.config.type).toBe(RELEASE.flags.config.type);
    expect(GATE.flags.root.type).toBe(RELEASE.flags.root.type);
  });

  it("defaults both config paths into the same directory", () => {
    expect(DEFAULT_STEPS_CONFIG.startsWith("config/")).toBe(true);
  });
});

describe("createGateBinCommand() — the table module's GATE_INPUTS", () => {
  function table(gateInputs: string): string {
    return [
      `export const GATE_INPUTS = ${gateInputs};`,
      'const ok = { ok: true, findings: [], summary: "" };',
      'export default [{ label: "src-only", run: () => ok, watches: ["src/**"] }];',
      "",
    ].join("\n");
  }

  async function runBin(root: string): Promise<{ logs: string[]; code: number | undefined }> {
    const logs: string[] = [];
    let code: number | undefined;
    const ctx: CliContext = {
      io: {
        stdout: (msg: string) => logs.push(msg),
        stderr: (msg: string) => logs.push(msg),
        exit: (exitCode: number): never => {
          code = exitCode;
          throw new Error("exit");
        },
      },
      out: PLAIN,
      err: PLAIN,
      width: 80,
    };
    const original = console.log;
    const originalError = console.error;
    console.log = (msg: string) => logs.push(msg);
    console.error = (msg: string) => logs.push(msg);
    try {
      await GATE.run?.([], { root, config: "gate/steps.ts", affected: true, full: false, list: false, fix: false, only: [] } as never, ctx);
    } catch (error) {
      if (code === undefined) throw error;
    } finally {
      console.log = original;
      console.error = originalError;
    }
    return { logs, code };
  }

  it("runs every step when a change matches a glob the table module adds", async () => {
    const root = worktreeFixture({ "gate/steps.ts": table('["assets/**"]'), "src/a.ts": "a\n", "assets/logo.svg": "<svg/>\n" });
    writeFileSync(join(root, "assets/logo.svg"), "<svg></svg>\n");
    const { logs, code } = await runBin(root);

    expect(code).toBeUndefined();
    expect(logs.some((line) => line.startsWith("✓ src-only"))).toBe(true);
  });

  it("treats the table module itself as a gate-wide input", async () => {
    const root = worktreeFixture({ "gate/steps.ts": table("[]"), "src/a.ts": "a\n" });
    mkdirSync(join(root, "gate"), { recursive: true });
    writeFileSync(join(root, "gate/steps.ts"), table("[]") + "\n");
    const { logs } = await runBin(root);

    expect(logs.some((line) => line.startsWith("✓ src-only"))).toBe(true);
  });

  it("refuses a GATE_INPUTS that is not an array of glob strings", async () => {
    const root = worktreeFixture({ "gate/steps.ts": table('"assets/**"'), "src/a.ts": "a\n" });
    const { logs, code } = await runBin(root);

    expect(code).toBe(1);
    expect(logs).toContain("`gate/steps.ts` exports GATE_INPUTS, which must be an array of glob strings.");
  });
});
