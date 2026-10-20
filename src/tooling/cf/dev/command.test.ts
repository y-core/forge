import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { execute } from "../../cli/execute";
import type { CliIO, SpawnOptions, SpawnOutcome } from "../../cli/types";
import { createDevCommand } from "./command";

class ExitSignal extends Error {}

// The injected seam, not `mock.module`: a module mock is process-global and Bun never restores it,
// so it reaches whatever loads `node:child_process` after this file and decides by load order.
const spawn = mock((_cmd: string, _args: string[], _opts: SpawnOptions): SpawnOutcome => ({ status: 0 }));

const ambient = process.env.WRANGLER_BUILD_CONDITIONS;

beforeEach(() => {
  spawn.mockClear();
  spawn.mockImplementation(() => ({ status: 0 }));
  delete process.env.WRANGLER_BUILD_CONDITIONS;
});

afterEach(() => {
  if (ambient === undefined) delete process.env.WRANGLER_BUILD_CONDITIONS;
  else process.env.WRANGLER_BUILD_CONDITIONS = ambient;
});

async function runDev(argv: string[]): Promise<{ exits: number[]; err: string[]; out: string[] }> {
  const exits: number[] = [];
  const err: string[] = [];
  const out: string[] = [];
  let exited = false;
  const io: CliIO = {
    stdout: (msg) => {
      if (!exited) out.push(msg);
    },
    stderr: (msg) => {
      if (!exited) err.push(msg);
    },
    exit: (code) => {
      if (!exited) exits.push(code);
      exited = true;
      throw new ExitSignal();
    },
  };
  try {
    await execute(createDevCommand(spawn), argv, io);
  } catch (thrown) {
    if (!(thrown instanceof ExitSignal)) throw thrown;
  }
  return { exits, err, out };
}

function spawned(): { cmd: string; args: string[]; opts: SpawnOptions } {
  const call = spawn.mock.calls[0];
  if (call === undefined) throw new Error("wrangler was never spawned");
  return { cmd: call[0], args: call[1], opts: call[2] };
}

describe("createDevCommand — the child process", () => {
  it("runs wrangler with inherited stdio", async () => {
    await runDev([]);
    expect([spawn.mock.calls.length, spawned().cmd, spawned().opts.stdio]).toEqual([1, "wrangler", "inherit"]);
  });

  it("passes `dev` and the `__FORGE_DEV__` define ahead of anything else", async () => {
    await runDev([]);
    expect(spawned().args).toEqual(["dev", "--define", "__FORGE_DEV__:true"]);
  });

  it("gives the child wrangler's default conditions plus forge-dev when the variable is unset", async () => {
    await runDev([]);
    expect(spawned().opts.env.WRANGLER_BUILD_CONDITIONS).toBe("workerd,worker,browser,forge-dev");
  });

  it("preserves an existing condition list and appends forge-dev after it", async () => {
    process.env.WRANGLER_BUILD_CONDITIONS = "workerd,custom";
    await runDev([]);
    expect(spawned().opts.env.WRANGLER_BUILD_CONDITIONS).toBe("workerd,custom,forge-dev");
  });

  it("does not repeat forge-dev when the parent's list already carries it", async () => {
    process.env.WRANGLER_BUILD_CONDITIONS = "forge-dev,workerd";
    await runDev([]);
    expect(spawned().opts.env.WRANGLER_BUILD_CONDITIONS).toBe("workerd,forge-dev");
  });

  it("gives the child forge-dev alone when the variable is set but empty, as wrangler then drops its defaults", async () => {
    process.env.WRANGLER_BUILD_CONDITIONS = "";
    await runDev([]);
    expect(spawned().opts.env.WRANGLER_BUILD_CONDITIONS).toBe("forge-dev");
  });

  it("carries the rest of the parent's env into the child", async () => {
    process.env.FORGE_DEV_COMMAND_PROBE = "kept";
    try {
      await runDev([]);
      expect(spawned().opts.env.FORGE_DEV_COMMAND_PROBE).toBe("kept");
    } finally {
      delete process.env.FORGE_DEV_COMMAND_PROBE;
    }
  });

  it("leaves the parent's env untouched, whether the variable was unset or set", async () => {
    await runDev([]);
    const unset = process.env.WRANGLER_BUILD_CONDITIONS;
    process.env.WRANGLER_BUILD_CONDITIONS = "workerd,custom";
    await runDev([]);
    expect([unset, process.env.WRANGLER_BUILD_CONDITIONS, spawned().opts.env === process.env]).toEqual([undefined, "workerd,custom", false]);
  });
});

describe("createDevCommand — passthrough", () => {
  it("forwards every argument after `--` to wrangler, flags included, after the define", async () => {
    const { exits } = await runDev(["--", "--port", "8788", "-c", "wrangler.jsonc"]);
    expect([exits, spawned().args]).toEqual([[], ["dev", "--define", "__FORGE_DEV__:true", "--port", "8788", "-c", "wrangler.jsonc"]]);
  });

  it("does not answer a `--help` that follows `--`, but hands it to wrangler", async () => {
    const { out } = await runDev(["--", "--help"]);
    expect([out, spawned().args.at(-1)]).toEqual([[], "--help"]);
  });

  it("refuses a wrangler flag given without `--`, before spawning anything", async () => {
    const { exits, err } = await runDev(["--port", "8788"]);
    expect([exits, err, spawn.mock.calls.length]).toEqual([[1], ["Error: Unknown flag: --port."], 0]);
  });
});

describe("createDevCommand — exit", () => {
  it("returns without exiting when wrangler exits 0", async () => {
    expect((await runDev([])).exits).toEqual([]);
  });

  it("exits with wrangler's own non-zero code", async () => {
    spawn.mockImplementation(() => ({ status: 7 }));
    const { exits, err } = await runDev([]);
    expect([exits, err]).toEqual([[7], []]);
  });

  it("exits 1 when wrangler ends on a signal with no exit code", async () => {
    spawn.mockImplementation(() => ({ status: null }));
    const { exits, err } = await runDev([]);
    expect([exits, err]).toEqual([[1], []]);
  });

  it("fails naming the spawner's error when wrangler cannot be started", async () => {
    spawn.mockImplementation(() => ({ status: null, error: new Error("spawnSync wrangler ENOENT") }));
    const { exits, err } = await runDev([]);
    expect([exits, err]).toEqual([[1], ["Error: wrangler could not be started: spawnSync wrangler ENOENT"]]);
  });
});

describe("createDevCommand — help", () => {
  it("says the define reaches only the first -c config, and shows the passthrough form", () => {
    const { description } = createDevCommand(spawn);
    expect([
      description.includes("With several -c configs the define reaches only the first, so put the app's config first"),
      description.includes("`forge cf dev -- --port 8788`"),
    ]).toEqual([true, true]);
  });

  it("takes any number of arguments and declares no flags of its own", () => {
    const dev = createDevCommand(spawn);
    expect([dev.name, dev.args, dev.flags]).toEqual(["dev", { kind: "min", min: 0 }, {}]);
  });
});
