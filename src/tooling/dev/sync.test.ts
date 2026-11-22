import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SpawnOptions, SpawnOutcome } from "../cli/types";
import { syncForge, syncReport } from "./sync";

// The injected seam, not `mock.module`: a module mock is process-global and Bun never restores it,
// so it reaches whatever loads `node:child_process` after this file and decides by load order.
const spawn = mock((_command: string, _args: string[], _options: SpawnOptions): SpawnOutcome => ({ status: 0 }));

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function consumer(installed: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "forge-sync-"));
  roots.push(root);
  if (installed) {
    const dir = join(root, "node_modules", "@y-core", "forge");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "stale.ts"), "export const stale = true;\n", "utf-8");
    writeFileSync(join(dir, ".bun-tag"), "sha512-pinned", "utf-8");
  }
  return root;
}

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

  // Bun counts a package as installed while its directory holds `.bun-tag`; deleting it is what makes `bun i` the undo.
  it("removes the install tag before extracting, so a plain `bun i` reinstalls the pinned release", () => {
    const root = consumer(true);
    const tag = join(root, "node_modules", "@y-core", "forge", ".bun-tag");
    let taggedAtExtract: boolean | undefined;
    spawn.mockImplementation((command: string) => {
      if (command === "tar") taggedAtExtract = existsSync(tag);
      return { status: 0 };
    });
    syncForge(root, spawn);
    expect(taggedAtExtract).toBe(false);
  });

  it("throws with the command and its stderr when a step exits non-zero", () => {
    spawn.mockImplementation(() => ({ status: 1, stderr: "pack refused" }));
    expect(() => syncForge(consumer(true), spawn)).toThrow(/bun pm pack .* exited 1[\s\S]*pack refused/);
  });

  it("treats the null status a signalled process reports as a failure, never as the zero it is not", () => {
    spawn.mockImplementation(() => ({ status: null }));
    expect(() => syncForge(consumer(true), spawn)).toThrow(/bun pm pack .* exited 1/);
  });

  it("ends its report with the undo, so the consumer knows how to return to the release", () => {
    expect(syncReport("/app").split("\n").slice(-2)).toEqual(["Restore the pinned release:", "  bun i"]);
  });

  it("defaults to a real spawner, so the command path is not one only a test supplies", () => {
    expect(() => syncForge(consumer(false))).toThrow(/no @y-core\/forge installed/);
  });
});
