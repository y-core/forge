import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { readdirSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter } from "node:path";

import { capture, hasTool, insertPath, probeOk, requireTools, run } from "./proc";
import type { SpawnOptions, SpawnOutcome } from "./types";

// The injected seam, not `mock.module`: a module mock is process-global and Bun never restores it,
// so it reaches whatever loads `node:child_process` after this file and decides by load order.
const mockSpawnSync = mock((_cmd: string, _args: string[], _opts: SpawnOptions): SpawnOutcome => ({ status: 0 }));

describe("run()", () => {
  it("returns 0 and spawns with inherited stdio on success", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValue({ status: 0 });

    expect(run("echo", ["hi"], undefined, mockSpawnSync)).toBe(0);
    expect(mockSpawnSync.mock.calls).toHaveLength(1);
    expect(mockSpawnSync.mock.calls[0]![0]).toBe("echo");
    expect(mockSpawnSync.mock.calls[0]![1]).toEqual(["hi"]);
    expect((mockSpawnSync.mock.calls[0]![2] as { stdio?: string }).stdio).toBe("inherit");
  });

  it("throws naming the command and exit code when status is non-zero", () => {
    mockSpawnSync.mockReturnValue({ status: 2 });
    expect(() => run("cargo", ["build"], undefined, mockSpawnSync)).toThrow("`cargo build` failed (exit 2)");
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  it("passes cwd through when provided", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValue({ status: 0 });

    run("ls", ["-la"], { cwd: "/tmp" }, mockSpawnSync);
    expect((mockSpawnSync.mock.calls[0]![2] as { cwd?: string }).cwd).toBe("/tmp");
  });

  it("omits cwd (no repo-root default) when not provided", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValue({ status: 0 });

    run("ls", ["-la"], undefined, mockSpawnSync);
    expect((mockSpawnSync.mock.calls[0]![2] as { cwd?: string }).cwd).toBeUndefined();
  });
});

describe("capture()", () => {
  type SpawnOpts = { stdio?: (string | number)[]; cwd?: string };
  function fakeChild(writes: string[], status: number | null = 0, error?: Error) {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockImplementation((_cmd, _args, opts) => {
      const fd = (opts as SpawnOpts).stdio?.[1];
      if (typeof fd === "number") for (const chunk of writes) writeSync(fd, chunk);
      return error ? { status, error } : { status };
    });
  }
  afterEach(() => {
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  it("returns the child's combined output interleaved in write order", () => {
    fakeChild(["out-1\n", "err-1\n", "out-2\n"]);

    expect(capture("oxfmt", ["--check"], undefined, mockSpawnSync).output).toBe("out-1\nerr-1\nout-2\n");
  });

  it("returns a non-zero exit code without throwing", () => {
    fakeChild(["boom\n"], 2);

    const result = capture("oxfmt", ["--check"], undefined, mockSpawnSync);
    expect(result.code).toBe(2);
    expect(result.output).toBe("boom\n");
  });

  it("reports a null status (signal kill) as exit code 1", () => {
    fakeChild([], null);

    expect(capture("tsc", ["--noEmit"], undefined, mockSpawnSync).code).toBe(1);
  });

  it("appends the spawn error when the process never started", () => {
    fakeChild([], null, new Error("spawnSync nope ENOENT"));

    const result = capture("nope", [], undefined, mockSpawnSync);
    expect(result.code).toBe(1);
    expect(result.output).toBe("spawnSync nope ENOENT\n");
  });

  it("points stdout and stderr at one fd and ignores stdin", () => {
    fakeChild([]);

    capture("echo", ["hi"], undefined, mockSpawnSync);
    const stdio = (mockSpawnSync.mock.calls[0]![2] as SpawnOpts).stdio!;
    expect(stdio[0]).toBe("ignore");
    expect(typeof stdio[1]).toBe("number");
    expect(stdio[2]).toBe(stdio[1]);
  });

  it("passes cwd through when provided and omits it when not", () => {
    fakeChild([]);

    capture("ls", [], { cwd: "/tmp" }, mockSpawnSync);
    capture("ls", [], undefined, mockSpawnSync);
    expect((mockSpawnSync.mock.calls[0]![2] as SpawnOpts).cwd).toBe("/tmp");
    expect((mockSpawnSync.mock.calls[1]![2] as SpawnOpts).cwd).toBeUndefined();
  });

  it("spawns with the env it is given, and with the process env when given none", () => {
    fakeChild([]);
    const env = { PATH: "/bin", FORGE_APP_ROOT: "/tmp/skeleton" };

    capture("ls", [], { env }, mockSpawnSync);
    capture("ls", [], undefined, mockSpawnSync);
    expect((mockSpawnSync.mock.calls[0]![2] as SpawnOptions).env).toBe(env);
    expect((mockSpawnSync.mock.calls[1]![2] as SpawnOptions).env).toBe(process.env);
  });

  it("reports elapsed milliseconds", () => {
    fakeChild([]);

    expect(capture("echo", ["hi"], undefined, mockSpawnSync).ms).toBeGreaterThanOrEqual(0);
  });

  it("removes its temp directory on both the success and failure paths", () => {
    const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith("forge-capture-")).length;
    const before = leftovers();

    fakeChild(["ok\n"]);
    capture("echo", ["hi"], undefined, mockSpawnSync);
    fakeChild(["bad\n"], 1);
    capture("echo", ["hi"], undefined, mockSpawnSync);

    expect(leftovers()).toBe(before);
  });
});

describe("probeOk()", () => {
  type SpawnCallOpts = { stdio?: string };
  afterEach(() => {
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  it("returns true when the probe exits 0", () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    expect(probeOk("docker", ["compose", "ps", "--quiet"], mockSpawnSync)).toBe(true);
  });

  it("returns false when the probe exits non-zero", () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    expect(probeOk("docker", ["compose", "ps", "--quiet"], mockSpawnSync)).toBe(false);
  });

  it("returns false when the probe never started at all (spawn error, null status)", () => {
    mockSpawnSync.mockReturnValue({ status: null, error: new Error("spawnSync forge-no-such-binary ENOENT") });
    expect(probeOk("forge-no-such-binary", ["--version"], mockSpawnSync)).toBe(false);
  });

  it("spawns exactly the command and arguments it was given, with all output discarded", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValue({ status: 0 });

    probeOk("docker", ["compose", "ps", "--quiet"], mockSpawnSync);

    expect(mockSpawnSync.mock.calls).toHaveLength(1);
    expect(mockSpawnSync.mock.calls[0]![0]).toBe("docker");
    expect(mockSpawnSync.mock.calls[0]![1]).toEqual(["compose", "ps", "--quiet"]);
    expect((mockSpawnSync.mock.calls[0]![2] as SpawnCallOpts).stdio).toBe("ignore");
  });

  it("copies the caller's args rather than handing the declared tuple to the spawner", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValue({ status: 0 });
    const declared = ["compose", "ps", "--quiet"];

    probeOk("docker", declared, mockSpawnSync);

    expect(mockSpawnSync.mock.calls[0]![1]).toEqual(declared);
    expect(mockSpawnSync.mock.calls[0]![1]).not.toBe(declared);
  });
});

describe("hasTool()", () => {
  it("returns true when --version exits 0", () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    expect(hasTool("node", mockSpawnSync)).toBe(true);
  });

  it("returns false when --version exits non-zero", () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    expect(hasTool("nope", mockSpawnSync)).toBe(false);
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  it("returns false when the tool never started at all", () => {
    mockSpawnSync.mockReturnValue({ status: null, error: new Error("spawnSync nope ENOENT") });
    expect(hasTool("nope", mockSpawnSync)).toBe(false);
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  it("probes with exactly `--version` and no other argument", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValue({ status: 0 });

    hasTool("tsc", mockSpawnSync);

    expect(mockSpawnSync.mock.calls[0]![0]).toBe("tsc");
    expect(mockSpawnSync.mock.calls[0]![1]).toEqual(["--version"]);
  });
});

describe("requireTools()", () => {
  it("passes when every tool is present", () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    expect(() => requireTools({ cargo: "install rust", node: "install node" }, mockSpawnSync)).not.toThrow();
  });

  const cases = [
    { name: "first tool missing", statuses: [1, 0], expected: "cargo not found — install rust" },
    { name: "second tool missing", statuses: [0, 1], expected: "node not found — install node" },
  ];
  for (const { name, statuses, expected } of cases) {
    it(`throws the exact hint message when ${name}`, () => {
      let i = 0;
      mockSpawnSync.mockImplementation(() => ({ status: statuses[i++] ?? 0 }));
      expect(() => requireTools({ cargo: "install rust", node: "install node" }, mockSpawnSync)).toThrow(expected);
      mockSpawnSync.mockReturnValue({ status: 0 });
    });
  }
});

describe("insertPath()", () => {
  const present = process.cwd();
  const missing = "/no/such/forge/cli/dir";
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.PATH;
  });
  afterEach(() => {
    process.env.PATH = original;
  });

  it("prepends a present dir that is absent from PATH", () => {
    process.env.PATH = "/usr/bin";
    insertPath(present);
    expect(process.env.PATH).toBe(`${present}${delimiter}/usr/bin`);
  });

  it("is idempotent — a second call is a no-op", () => {
    process.env.PATH = "/usr/bin";
    insertPath(present);
    const afterFirst = process.env.PATH;
    insertPath(present);
    expect(process.env.PATH).toBe(afterFirst);
  });

  it("is a no-op for a non-existent dir", () => {
    process.env.PATH = "/usr/bin";
    insertPath(missing);
    expect(process.env.PATH).toBe("/usr/bin");
  });

  it("is a no-op when the dir is already present", () => {
    process.env.PATH = `${present}${delimiter}/usr/bin`;
    insertPath(present);
    expect(process.env.PATH).toBe(`${present}${delimiter}/usr/bin`);
  });

  it("is a no-op for an empty dir string", () => {
    process.env.PATH = "/usr/bin";
    insertPath("");
    expect(process.env.PATH).toBe("/usr/bin");
  });
});

// No seam passed: these reach the real `spawnSync`, which is what the default argument resolves to.
// Reaching it needed a child process while this file mocked the module for the whole process.
describe("probeOk() and hasTool() — against real processes", () => {
  const MISSING = "forge-no-such-binary-9f3a";

  it("returns true for a command that really exits zero", () => {
    expect(probeOk("node", ["--version"])).toBe(true);
  });

  it("returns false for a command that really exits non-zero", () => {
    expect(probeOk("node", ["--no-such-flag-9f3a"])).toBe(false);
  });

  it("returns false, without throwing, for a command that does not exist", () => {
    expect(probeOk(MISSING, ["--version"])).toBe(false);
  });

  it("keeps hasTool answering true for a tool that is present", () => {
    expect(hasTool("node")).toBe(true);
  });

  it("keeps hasTool answering false for a tool that is absent", () => {
    expect(hasTool(MISSING)).toBe(false);
  });
});
