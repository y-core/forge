import { beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { syncForge } from "./sync";
import type { SpawnOutcome } from "./types";

// The injected seam, not `mock.module`: a module mock is process-global and Bun never restores it,
// so it reaches whatever loads `node:child_process` after this file and decides by load order.
const spawn = mock((_command: string, _args: string[], _cwd: string): SpawnOutcome => ({ status: 0 }));

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
  const call = spawn.mock.calls.find(([cmd]) => cmd === command);
  if (!call) throw new Error(`${command} was never spawned`);
  return call[1] ?? [];
}

describe("syncForge()", () => {
  beforeEach(() => {
    spawn.mockClear();
    spawn.mockImplementation(() => ({ status: 0 }));
  });

  it("refuses a root with no forge installed, rather than inventing the directory it overwrites", () => {
    expect(() => syncForge(consumer(false), spawn)).toThrow(/no @y-core\/forge installed/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("packs the checkout as publishing would, so the consumer receives only what `files` allows", () => {
    syncForge(consumer(true), spawn);
    expect(invocation("bun").slice(0, 3)).toEqual(["pm", "pack", "--ignore-scripts"]);
  });

  it("strips the tarball's wrapper directory, since `package/` is not part of the installed path", () => {
    const root = consumer(true);
    syncForge(root, spawn);
    const args = invocation("tar");
    expect(args).toContain("--strip-components=1");
    expect(args).toContain(join(root, "node_modules", "@y-core", "forge"));
  });

  it("clears the installed tree first, so a file dropped since the pin does not survive the sync", () => {
    const root = consumer(true);
    syncForge(root, spawn);
    expect(existsSync(join(root, "node_modules", "@y-core", "forge", "stale.ts"))).toBe(false);
  });

  // The pack runs against this checkout and the untar against the consumer, so a failure in either
  // must name which command exited and carry its stderr — the only thing the caller can act on.
  it("throws with the command and its stderr when a step exits non-zero", () => {
    spawn.mockImplementation(() => ({ status: 1, stderr: "pack refused" }));
    expect(() => syncForge(consumer(true), spawn)).toThrow(/bun pm pack .* exited 1[\s\S]*pack refused/);
  });

  it("defaults to a real spawner, so the command path is not one only a test supplies", () => {
    expect(() => syncForge(consumer(false))).toThrow(/no @y-core\/forge installed/);
  });
});
