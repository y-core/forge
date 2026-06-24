import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as childProcess from "node:child_process";
import { delimiter } from "node:path";

// Install mock before ./proc is loaded so its top-level import gets the stub.
// Only spawnSync is overridden — node:fs/node:path stay real so insertPath
// exercises genuine on-disk existence checks against process.cwd(). mock.module is
// process-global, so we spread the real module to preserve its other exports (e.g.
// execFileSync, which a sibling test file mocks) rather than replacing it wholesale.
const mockSpawnSync = mock((_cmd: string, _args?: string[], _opts?: unknown): { status: number | null } => ({ status: 0 }));
mock.module("node:child_process", () => ({ ...childProcess, spawnSync: mockSpawnSync }));

const { run, hasTool, requireTools, insertPath } = await import("./proc");

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
  const present = process.cwd(); // guaranteed to exist on disk
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
