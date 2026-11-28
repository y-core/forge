import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";

import { execute } from "../../../src/tooling/cli/execute";
import type { CliIO } from "../../../src/tooling/cli/types";
import { gateFixtureRoot } from "../../../src/tooling/gate/checks/gate.fixture";
import { checkPatterns } from "../steps";
import { createWardenCommands } from "./commands";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const RULES = `export default [
  { id: "forge-no-todo", statement: "Never leave a TODO.", detectors: [{ kind: "rg", pattern: "TODO", paths: ["src/"], level: "fail" }] },
  {
    id: "forge-env-read",
    statement: "Read config through the schema.",
    detectors: [{ kind: "rg", pattern: "c\\\\.env\\\\.[A-Z]+", paths: ["src/"], level: "warn", triage: "A binding is fine." }],
  },
];
`;

const FILES = {
  "docs/RULES.md": ["## 1. Rules", "", "<!-- rule:forge-no-todo --> Because.", "", "<!-- rule:forge-env-read --> Because too.", ""].join("\n"),
  "config/rules.config.ts": RULES,
  "src/a.ts": "// TODO later\nconst db = c.env.DB;\nconst k = c.env.KEY;\n",
  "src/b.ts": "fine\n",
};

function fixture(files: Record<string, string> = FILES): string {
  const root = gateFixtureRoot(files, "warden-check-cli-");
  roots.push(root);
  return root;
}

async function warden(root: string, ...argv: string[]): Promise<{ out: string; code: number | null }> {
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

describe("warden check", () => {
  it("prints each rule with hits once — statement, rationale, triage and the rg command — then its hits, and exits 1 on a fail-level hit", async () => {
    const { out, code } = await warden(fixture(), "check");

    expect(out.split("\n")).toEqual([
      "[forge-no-todo] fail — Never leave a TODO.",
      "  rationale: project:docs/RULES.md#1",
      "  rg: rg -n -e TODO src/",
      "  src/a.ts:1: // TODO later",
      "[forge-env-read] warn — Read config through the schema.",
      "  rationale: project:docs/RULES.md#1",
      "  triage: A binding is fine.",
      "  rg: rg -n -e 'c\\.env\\.[A-Z]+' src/",
      "  src/a.ts:2: const db = c.env.DB;",
      "  src/a.ts:3: const k = c.env.KEY;",
      "3 hit(s), 1 fail-level, across 2 rule(s) over 4 file(s)",
      "Error: 1 fail-level hit(s) — each is a rule the gate holds",
    ]);
    expect(code).toBe(1);
  });

  it("prints the report as JSON under --json, narrowed by --rules and --files", async () => {
    const { out, code } = await warden(fixture(), "check", "--json", "--rules=forge-env-read", "--files=src/a.ts");

    expect(code).toBeNull();
    expect(JSON.parse(out)).toEqual({
      findings: [
        { rule: "forge-env-read", level: "warn", file: "src/a.ts", line: 2, match: "const db = c.env.DB;" },
        { rule: "forge-env-read", level: "warn", file: "src/a.ts", line: 3, match: "const k = c.env.KEY;" },
      ],
      rules: [
        { id: "forge-env-read", statement: "Read config through the schema.", rationale: "project:docs/RULES.md#1", triage: "A binding is fine." },
      ],
      scanned: 1,
    });
  });

  it("refuses --files with --diff, and an unknown rule id", async () => {
    const root = fixture();
    expect((await warden(root, "check", "--files=src/a.ts", "--diff=HEAD")).out).toBe("Error: name --files or --diff, not both");
    expect((await warden(root, "check", "--rules=forge-ghost")).out).toBe("Error: no registered rule is named `forge-ghost`");
  });
});

describe("checkPatterns() — the warden:check step", () => {
  it("fails each fail-level hit with its statement and rule id, and warns once per warn rule naming the listing command", () => {
    const result = checkPatterns({ root: fixture(), kind: "libs" });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      { level: "fail", message: "Never leave a TODO.", file: "src/a.ts", line: 1, rule: "forge-no-todo", detail: ["// TODO later"] },
      {
        level: "warn",
        message: "2 hit(s) to triage — `warden check --rules forge-env-read` lists them with the triage",
        rule: "forge-env-read",
        file: "src/a.ts",
        line: 2,
      },
    ]);
  });

  it("passes a tree no fail-level pattern matches, summarising the patterns and files", () => {
    const result = checkPatterns({ root: fixture({ ...FILES, "src/a.ts": "clean\n" }), kind: "libs", trees: [] });

    expect(result).toEqual({ ok: true, findings: [], summary: "2 patterns over 2 files" });
  });

  it("runs a canon tree's rules only in a repository of that kind", () => {
    const rulesOf = (kind: "libs" | "apps", trees: readonly ("shared" | "libs" | "apps")[]) =>
      checkPatterns({ root: fixture(), kind, trees }).findings.map((finding) => finding.rule);

    expect(rulesOf("libs", ["shared", "libs", "apps"])).toEqual(["forge-no-todo", "forge-env-read"]);
    expect(rulesOf("apps", ["shared", "apps"])).toEqual(["forge-no-todo", "forge-env-read", "apps-code-review-raw-env"]);
  });
});
