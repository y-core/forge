import { describe, expect, it } from "bun:test";
import { addCommand, createCommand } from "./command";
import { execute } from "./execute";
import type { CliIO, CommandBase } from "./types";

class ExitSignal extends Error {
  constructor(public readonly code: number) {
    super(`exit(${code})`);
  }
}

function makeIO() {
  const out: string[] = [];
  const err: string[] = [];
  const state = { exitCode: null as number | null };
  const io: CliIO = {
    stdout: (msg) => {
      out.push(msg);
    },
    stderr: (msg) => {
      err.push(msg);
    },
    exit: (code) => {
      state.exitCode = code;
      throw new ExitSignal(code);
    },
  };
  return { io, out, err, state };
}

async function run(cmd: CommandBase, argv: string[], io: CliIO): Promise<void> {
  try {
    await execute(cmd, argv, io);
  } catch (e) {
    if (!(e instanceof ExitSignal)) throw e;
  }
}

describe("execute()", () => {
  it("calls run handler with no args", async () => {
    let called = false;
    const cmd = createCommand({ name: "root", run: () => { called = true; } });
    const { io } = makeIO();
    await run(cmd, [], io);
    expect(called).toBe(true);
  });

  it("passes parsed flags to run handler", async () => {
    let received: Record<string, unknown> = {};
    const cmd = createCommand({
      name: "root",
      flags: { verbose: { type: "boolean", short: "v" } },
      run: (_args, flags) => { received = flags; },
    });
    const { io } = makeIO();
    await run(cmd, ["-v"], io);
    expect(received.verbose).toBe(true);
  });

  it("passes positional args to run handler", async () => {
    let received: string[] = [];
    const cmd = createCommand({
      name: "root",
      args: { kind: "min", min: 1 },
      run: (args) => { received = args; },
    });
    const { io } = makeIO();
    await run(cmd, ["foo", "bar"], io);
    expect(received).toEqual(["foo", "bar"]);
  });

  it("routes to the correct subcommand", async () => {
    let ran = "none";
    const root = createCommand({ name: "root" });
    const sub = createCommand({ name: "sub", run: () => { ran = "sub"; } });
    addCommand(root, sub);
    const { io } = makeIO();
    await run(root, ["sub"], io);
    expect(ran).toBe("sub");
  });

  it("routes to nested subcommand", async () => {
    let ran = "none";
    const root = createCommand({ name: "root" });
    const mid = createCommand({ name: "mid" });
    const leaf = createCommand({ name: "leaf", run: () => { ran = "leaf"; } });
    addCommand(root, mid);
    addCommand(mid, leaf);
    const { io } = makeIO();
    await run(root, ["mid", "leaf"], io);
    expect(ran).toBe("leaf");
  });

  it("prints help for --help flag", async () => {
    const cmd = createCommand({ name: "mytool", description: "My great tool" });
    const { io, out } = makeIO();
    await run(cmd, ["--help"], io);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("My great tool");
  });

  it("prints help for -h flag", async () => {
    const cmd = createCommand({ name: "mytool", description: "My great tool" });
    const { io, out } = makeIO();
    await run(cmd, ["-h"], io);
    expect(out[0]).toContain("My great tool");
  });

  it("prints help when group command called with no subcommand", async () => {
    const root = createCommand({ name: "root" });
    addCommand(root, createCommand({ name: "sub" }));
    const { io, out } = makeIO();
    await run(root, [], io);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Usage:");
  });

  it("writes to stderr and exits(1) on unknown flag", async () => {
    const cmd = createCommand({ name: "root", run: () => {} });
    const { io, err, state } = makeIO();
    await run(cmd, ["--nonexistent"], io);
    expect(err).toHaveLength(1);
    expect(err[0]).toContain("Error:");
    expect(state.exitCode).toBe(1);
  });

  it("writes to stderr and exits(1) on invalid arg count", async () => {
    const cmd = createCommand({
      name: "root",
      args: { kind: "exact", count: 2 },
      run: () => {},
    });
    const { io, err, state } = makeIO();
    await run(cmd, ["only-one"], io);
    expect(err[0]).toContain("Error:");
    expect(state.exitCode).toBe(1);
  });

  it("writes to stderr and exits(1) for missing-command (no run, no subcommands)", async () => {
    const cmd = createCommand({ name: "root" });
    const { io, err, state } = makeIO();
    await run(cmd, [], io);
    expect(err[0]).toContain("Error:");
    expect(state.exitCode).toBe(1);
  });

  it("awaits async run handlers", async () => {
    let resolved = false;
    const cmd = createCommand({
      name: "root",
      run: async () => {
        await Promise.resolve();
        resolved = true;
      },
    });
    const { io } = makeIO();
    await run(cmd, [], io);
    expect(resolved).toBe(true);
  });

  it("inherits persistent flags from parent across subcommand boundary", async () => {
    let received: Record<string, unknown> = {};
    const root = createCommand({
      name: "root",
      flags: { debug: { type: "boolean", persistent: true } },
    });
    const sub = createCommand({
      name: "sub",
      run: (_args, flags) => { received = flags; },
    });
    addCommand(root, sub);
    const { io } = makeIO();
    await run(root, ["sub", "--debug"], io);
    expect(received.debug).toBe(true);
  });
});
