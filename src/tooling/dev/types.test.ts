import { describe, expect, it } from "bun:test";

import type { SpawnCommand, SpawnOutcome } from "./types";

describe("SpawnCommand", () => {
  // The seam exists so a test can stand in for the real spawner; a shape the real one cannot satisfy
  // would send every caller back to mocking `node:child_process`, which is what it replaced.
  it("is satisfied by an outcome carrying a status alone, which is all a success needs", () => {
    const spawn: SpawnCommand = () => ({ status: 0 });
    expect(spawn("bun", ["pm", "pack"], "/tmp")).toEqual({ status: 0 });
  });

  it("carries stderr alongside a non-zero status, since that is what a thrown message quotes", () => {
    const spawn: SpawnCommand = () => ({ status: 1, stderr: "pack refused" });
    expect(spawn("bun", [], "/tmp")).toEqual({ status: 1, stderr: "pack refused" });
  });

  // `spawnSync` reports a signalled kill as a null status, so the type admits it and `syncForge`
  // treats it as a failure rather than reading it as the zero it is not.
  it("admits the null status a signalled process reports", () => {
    const outcome: SpawnOutcome = { status: null };
    expect(outcome.status).toBeNull();
  });

  it("receives the command, its argv and the directory to run in, in that order", () => {
    const seen: unknown[] = [];
    const spawn: SpawnCommand = (command, args, cwd) => {
      seen.push(command, args, cwd);
      return { status: 0 };
    };
    spawn("tar", ["-xzf", "forge.tgz"], "/consumer");

    expect(seen).toEqual(["tar", ["-xzf", "forge.tgz"], "/consumer"]);
  });
});
