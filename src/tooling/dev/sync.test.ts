import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as childProcess from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// mock.module must be registered before sync loads, hence the dynamic import below; it is
// process-global, so the real module is spread through.
const mockSpawnSync = mock((_cmd: string, _args?: string[], _opts?: unknown): { status: number | null } => ({ status: 0 }));
await mock.module("node:child_process", () => ({ ...childProcess, spawnSync: mockSpawnSync }));

const { syncForge } = await import("./sync");

/** A throwaway consumer root, optionally carrying the installed package the sync replaces. */
function consumer(installed: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "forge-sync-"));
  if (installed) {
    const dir = join(root, "node_modules", "@y-core", "forge");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "stale.ts"), "export const stale = true;\n", "utf-8");
  }
  return root;
}

/** The argv of the one call to `command`, so an assertion names the flag rather than an index. */
function invocation(command: string): string[] {
  const call = mockSpawnSync.mock.calls.find(([cmd]) => cmd === command);
  if (!call) throw new Error(`${command} was never spawned`);
  return call[1] ?? [];
}

describe("syncForge()", () => {
  beforeEach(() => {
    mockSpawnSync.mockClear();
  });

  it("refuses a root with no forge installed, rather than inventing the directory it overwrites", () => {
    expect(() => syncForge(consumer(false))).toThrow(/no @y-core\/forge installed/);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("packs the checkout as publishing would, so the consumer receives only what `files` allows", () => {
    syncForge(consumer(true));
    expect(invocation("bun").slice(0, 3)).toEqual(["pm", "pack", "--ignore-scripts"]);
  });

  it("strips the tarball's wrapper directory, since `package/` is not part of the installed path", () => {
    const root = consumer(true);
    syncForge(root);
    const args = invocation("tar");
    expect(args).toContain("--strip-components=1");
    expect(args).toContain(join(root, "node_modules", "@y-core", "forge"));
  });

  it("clears the installed tree first, so a file dropped since the pin does not survive the sync", () => {
    const root = consumer(true);
    syncForge(root);
    expect(existsSync(join(root, "node_modules", "@y-core", "forge", "stale.ts"))).toBe(false);
  });
});
