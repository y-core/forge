import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SESSION_BIN } from "./run";
import type { SessionRequest } from "./types";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function driver(input: string): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync("bun", [SESSION_BIN], { input, encoding: "utf-8", timeout: 30_000 });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe("session-bin.ts", () => {
  it("refuses a request that is not the shape the harness sends", () => {
    const run = driver(JSON.stringify({ argv: [], tree: "/tmp" }));
    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe("");
  });

  it("refuses the Code Mode arm before it spawns, when the caveats are not accepted", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-eval-session-bin-"));
    roots.push(root);
    mkdirSync(join(root, "tree"));
    writeFileSync(join(root, "claude.json"), "{}", "utf-8");
    const request: SessionRequest = {
      argv: ["false"],
      tree: join(root, "tree"),
      sessionId: "5d1c2b3a-4f5e-4a6b-8c7d-9e0f1a2b3c4d",
      projectsDir: join(root, "projects"),
      claudeJson: join(root, "claude.json"),
      codeMode: true,
      timeoutMs: 1_000,
      screenLog: join(root, "screen.pty.log"),
    };
    const run = driver(JSON.stringify(request));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("has not accepted Code Mode's caveats");
  });
});
