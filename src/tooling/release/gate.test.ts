import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_GATE_COMMAND, runGate } from "./gate";

const roots: string[] = [];

/** A project whose manifest declares `scripts`. */
function project(scripts: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-release-gate-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "gate-fixture", scripts }), "utf-8");
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("DEFAULT_GATE_COMMAND", () => {
  // What a consuming app gets with no `config/release.ts`, which is why it names the one script
  // every forge app declares. Forge's own gate is `config/release.ts`'s, asserted beside it.
  it("names a script a consuming app is certain to have, rather than a tier it may not declare", () => {
    expect([...DEFAULT_GATE_COMMAND]).toEqual(["bun", "run", "verify"]);
  });
});

describe("runGate()", () => {
  it("passes when the gate exits 0", () => {
    expect(runGate(project({ verify: "exit 0" }))).toBe("passed");
  });

  it("fails when the gate exits non-zero", () => {
    expect(runGate(project({ verify: "exit 1" }))).toBe("failed");
  });

  it("runs the command it is given rather than the default", () => {
    expect(runGate(project({ check: "exit 0" }), ["bun", "run", "check"])).toBe("passed");
    expect(runGate(project({ check: "exit 1" }), ["bun", "run", "check"])).toBe("failed");
  });

  // Every package runner reports a missing script as exit 1, which is also how a failing gate
  // exits — so the manifest is the only place the two can still be told apart.
  it("reads a script the manifest does not declare as unrunnable, not as a failure", () => {
    expect(runGate(project({ other: "exit 0" }))).toBe("unrunnable");
    expect(runGate(project({ verify: "exit 0" }), ["bun", "run", "check"])).toBe("unrunnable");
  });

  it("reads a prototype member name as a script the manifest does not declare", () => {
    expect(runGate(project({ verify: "exit 0" }), ["bun", "run", "toString"])).toBe("unrunnable");
  });

  it("is unrunnable in a directory holding no manifest at all", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-release-gate-"));
    roots.push(root);
    expect(runGate(root)).toBe("unrunnable");
  });

  it("is unrunnable when the binary itself is not there, rather than throwing", () => {
    expect(runGate(project({ verify: "exit 0" }), ["forge-gate-no-such-binary"])).toBe("unrunnable");
  });

  it("runs a command that is not a package script at all", () => {
    expect(runGate(project({}), ["true"])).toBe("passed");
    expect(runGate(project({}), ["false"])).toBe("failed");
  });
});
