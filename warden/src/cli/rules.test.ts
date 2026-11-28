import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";

import { execute } from "../../../src/tooling/cli/execute";
import type { CliIO } from "../../../src/tooling/cli/types";
import { gateFixtureRoot } from "../../../src/tooling/gate/checks/gate.fixture";
import { createWardenCommands } from "./commands";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const FILES = {
  "docs/RULES.md": ["## 1. Rules", "", "<!-- rule:forge-a --> Because tokens theme.", ""].join("\n"),
  "docs/LONGER.md": "Six words of prose live here.\n",
  "config/rules.config.ts": `export default [{ id: "forge-a", statement: "Never do a.", detectors: [{ kind: "review" }] }];\n`,
};

async function warden(...argv: string[]): Promise<{ out: string; code: number | null }> {
  const root = gateFixtureRoot(FILES, "warden-rules-cli-");
  roots.push(root);
  const out: string[] = [];
  let code: number | null = null;
  const io: CliIO = {
    stdout: (message) => out.push(message),
    stderr: (message) => out.push(message),
    exit: ((status: number) => {
      code = status;
    }) as CliIO["exit"],
  };
  const { log } = console;
  console.log = (...parts: unknown[]) => out.push(parts.join(" "));
  try {
    await execute(createWardenCommands(), [...argv, `--root=${root}`, "--kind=libs"], io);
  } finally {
    console.log = log;
  }
  return { out: out.join("\n"), code };
}

describe("warden rules", () => {
  it("prints each rule's id, detector class, rationale chunk id and statement, the repository's before the installed canon's", async () => {
    const { out, code } = await warden("rules");
    const lines = out.split("\n");

    expect(code).toBeNull();
    expect(lines.slice(0, 2)).toEqual(["forge-a  review-only  project:docs/RULES.md#1", "  Never do a."]);
    expect(lines).toContain("code-rules-comment-budget  automated  canon:CODE_RULES.md#5a");
    expect(lines.at(-1)).toBe(`${(lines.length - 1) / 2} rules`);
  });

  it("with --stats, counts rules by class and the words of each document, most first, with a total", async () => {
    const { out } = await warden("rules", "--stats");
    const lines = out.split("\n");
    const count = (label: string): number => Number(lines.find((line) => line.startsWith(`${label} `))?.slice(12));

    expect(count("review-only")).toBe(1);
    expect(count("automated") + count("test") + count("triaged") + count("runtime") + count("review-only")).toBe(count("rules"));
    expect(lines.slice(lines.indexOf("words"))).toEqual(["words", " 6  docs/LONGER.md", " 5  docs/RULES.md", "11  total, 2 documents"]);
  });
});
