import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import * as childProcess from "node:child_process";
import { readdirSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter } from "node:path";

// `mock.module` is process-global, so the real module is spread to preserve exports a sibling test file mocks (e.g. execFileSync).
const mockSpawnSync = mock((_cmd: string, _args?: string[], _opts?: unknown): { status: number | null; error?: Error } => ({ status: 0 }));
mock.module("node:child_process", () => ({ ...childProcess, spawnSync: mockSpawnSync }));

const { run, capture, hasTool, probeOk, requireTools, insertPath } = await import("./proc");

describe("run()", () => {
  it("returns 0 and spawns with inherited stdio on success", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValue({ status: 0 });

    expect(run("echo", ["hi"])).toBe(0);
    expect(mockSpawnSync.mock.calls).toHaveLength(1);
    expect(mockSpawnSync.mock.calls[0]![0]).toBe("echo");
    expect(mockSpawnSync.mock.calls[0]![1]).toEqual(["hi"]);
    expect((mockSpawnSync.mock.calls[0]![2] as { stdio?: string }).stdio).toBe("inherit");
  });

  it("throws naming the command and exit code when status is non-zero", () => {
    mockSpawnSync.mockReturnValue({ status: 2 });
    expect(() => run("cargo", ["build"])).toThrow("`cargo build` failed (exit 2)");
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  it("passes cwd through when provided", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValue({ status: 0 });

    run("ls", ["-la"], { cwd: "/tmp" });
    expect((mockSpawnSync.mock.calls[0]![2] as { cwd?: string }).cwd).toBe("/tmp");
  });

  it("omits cwd (no repo-root default) when not provided", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValue({ status: 0 });

    run("ls", ["-la"]);
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

    expect(capture("biome", ["check"]).output).toBe("out-1\nerr-1\nout-2\n");
  });

  it("returns a non-zero exit code without throwing", () => {
    fakeChild(["boom\n"], 2);

    const result = capture("biome", ["check"]);
    expect(result.code).toBe(2);
    expect(result.output).toBe("boom\n");
  });

  it("reports a null status (signal kill) as exit code 1", () => {
    fakeChild([], null);

    expect(capture("tsgo", ["--noEmit"]).code).toBe(1);
  });

  it("appends the spawn error when the process never started", () => {
    fakeChild([], null, new Error("spawnSync nope ENOENT"));

    const result = capture("nope", []);
    expect(result.code).toBe(1);
    expect(result.output).toBe("spawnSync nope ENOENT\n");
  });

  it("points stdout and stderr at one fd and ignores stdin", () => {
    fakeChild([]);

    capture("echo", ["hi"]);
    const stdio = (mockSpawnSync.mock.calls[0]![2] as SpawnOpts).stdio!;
    expect(stdio[0]).toBe("ignore");
    expect(typeof stdio[1]).toBe("number");
    expect(stdio[2]).toBe(stdio[1]);
  });

  it("passes cwd through when provided and omits it when not", () => {
    fakeChild([]);

    capture("ls", [], { cwd: "/tmp" });
    capture("ls", []);
    expect((mockSpawnSync.mock.calls[0]![2] as SpawnOpts).cwd).toBe("/tmp");
    expect((mockSpawnSync.mock.calls[1]![2] as SpawnOpts).cwd).toBeUndefined();
  });

  it("reports elapsed milliseconds", () => {
    fakeChild([]);

    expect(capture("echo", ["hi"]).ms).toBeGreaterThanOrEqual(0);
  });

  it("removes its temp directory on both the success and failure paths", () => {
    const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith("forge-capture-")).length;
    const before = leftovers();

    fakeChild(["ok\n"]);
    capture("echo", ["hi"]);
    fakeChild(["bad\n"], 1);
    capture("echo", ["hi"]);

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
    expect(probeOk("docker", ["compose", "ps", "--quiet"])).toBe(true);
  });

  it("returns false when the probe exits non-zero", () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    expect(probeOk("docker", ["compose", "ps", "--quiet"])).toBe(false);
  });

  it("returns false when the probe never started at all (spawn error, null status)", () => {
    mockSpawnSync.mockReturnValue({ status: null, error: new Error("spawnSync forge-no-such-binary ENOENT") });
    expect(probeOk("forge-no-such-binary", ["--version"])).toBe(false);
  });

  it("spawns exactly the command and arguments it was given, with all output discarded", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValue({ status: 0 });

    probeOk("docker", ["compose", "ps", "--quiet"]);

    expect(mockSpawnSync.mock.calls).toHaveLength(1);
    expect(mockSpawnSync.mock.calls[0]![0]).toBe("docker");
    expect(mockSpawnSync.mock.calls[0]![1]).toEqual(["compose", "ps", "--quiet"]);
    expect((mockSpawnSync.mock.calls[0]![2] as SpawnCallOpts).stdio).toBe("ignore");
  });

  it("copies the caller's args rather than handing the declared tuple to the spawner", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValue({ status: 0 });
    const declared = ["compose", "ps", "--quiet"];

    probeOk("docker", declared);

    expect(mockSpawnSync.mock.calls[0]![1]).toEqual(declared);
    expect(mockSpawnSync.mock.calls[0]![1]).not.toBe(declared);
  });
});

describe("hasTool()", () => {
  it("returns true when --version exits 0", () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    expect(hasTool("node")).toBe(true);
  });

  it("returns false when --version exits non-zero", () => {
    mockSpawnSync.mockReturnValue({ status: 1 });
    expect(hasTool("nope")).toBe(false);
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  it("returns false when the tool never started at all", () => {
    mockSpawnSync.mockReturnValue({ status: null, error: new Error("spawnSync nope ENOENT") });
    expect(hasTool("nope")).toBe(false);
    mockSpawnSync.mockReturnValue({ status: 0 });
  });

  it("probes with exactly `--version` and no other argument", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValue({ status: 0 });

    hasTool("tsgo");

    expect(mockSpawnSync.mock.calls[0]![0]).toBe("tsgo");
    expect(mockSpawnSync.mock.calls[0]![1]).toEqual(["--version"]);
  });
});

describe("requireTools()", () => {
  it("passes when every tool is present", () => {
    mockSpawnSync.mockReturnValue({ status: 0 });
    expect(() => requireTools({ cargo: "install rust", node: "install node" })).not.toThrow();
  });

  const cases = [
    { name: "first tool missing", statuses: [1, 0], expected: "cargo not found — install rust" },
    { name: "second tool missing", statuses: [0, 1], expected: "node not found — install node" },
  ];
  for (const { name, statuses, expected } of cases) {
    it(`throws the exact hint message when ${name}`, () => {
      let i = 0;
      mockSpawnSync.mockImplementation(() => ({ status: statuses[i++] ?? 0 }));
      expect(() => requireTools({ cargo: "install rust", node: "install node" })).toThrow(expected);
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

// A fresh `bun` child is the only way to reach the unmocked `spawnSync`, since `node:child_process` is replaced process-wide above.
declare const Bun: {
  spawnSync(opts: { cmd: string[]; cwd: string }): { exitCode: number; stdout: { toString(): string }; stderr: { toString(): string } };
};

interface RealAnswers {
  exitsZero: boolean;
  exitsNonZero: boolean;
  neverStarts: boolean;
  hasToolPresent: boolean;
  hasToolMissing: boolean;
}

describe("probeOk() and hasTool() — against real processes", () => {
  const MISSING = "forge-no-such-binary-9f3a";
  const source = [
    `import { hasTool, probeOk } from ${JSON.stringify(new URL("./proc.ts", import.meta.url).pathname)};`,
    "console.log(JSON.stringify({",
    '  exitsZero: probeOk("node", ["--version"]),',
    '  exitsNonZero: probeOk("node", ["--no-such-flag-9f3a"]),',
    `  neverStarts: probeOk(${JSON.stringify(MISSING)}, ["--version"]),`,
    '  hasToolPresent: hasTool("node"),',
    `  hasToolMissing: hasTool(${JSON.stringify(MISSING)}),`,
    "}));",
  ].join("\n");

  let real: RealAnswers | undefined;

  beforeAll(() => {
    const child = Bun.spawnSync({ cmd: ["bun", "-e", source], cwd: new URL("../../", import.meta.url).pathname });
    if (child.exitCode !== 0) throw new Error(`harness failed (exit ${child.exitCode}): ${child.stderr.toString()}`);
    real = JSON.parse(child.stdout.toString()) as RealAnswers;
  });

  it("returns true for a command that really exits zero", () => {
    expect(real?.exitsZero).toBe(true);
  });

  it("returns false for a command that really exits non-zero", () => {
    expect(real?.exitsNonZero).toBe(false);
  });

  it("returns false, without throwing, for a command that does not exist", () => {
    expect(real?.neverStarts).toBe(false);
  });

  it("keeps hasTool answering true for a tool that is present", () => {
    expect(real?.hasToolPresent).toBe(true);
  });

  it("keeps hasTool answering false for a tool that is absent", () => {
    expect(real?.hasToolMissing).toBe(false);
  });
});
