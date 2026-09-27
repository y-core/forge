import { describe, expect, it } from "bun:test";

import { gateFixtureRoot } from "./gate.fixture";
import { checkStubGlobals, declaredStubGlobals, findStubGlobalReferences } from "./stub-globals";

const STUB = `interface NodeStdioStream { write(data: string): boolean; }
declare const process: { readonly stdout: NodeStdioStream };
declare module "node:path" { export function join(...paths: string[]): string; interface PathApi {} }
`;

const config = (root: string) => ({ root, stubs: [".types"], shared: ["process"], sources: ["src"] });

describe("declaredStubGlobals", () => {
  it("reads the global declarations and none of a module block's members", () => {
    expect(declaredStubGlobals(STUB)).toEqual(["NodeStdioStream", "process"]);
  });

  it("reads a module-form file's `declare global` block, and none of its module-scoped declarations", () => {
    const source = `export {};\ninterface Local {}\ndeclare global { interface Leak { a: 1 } var leaked: string; }`;
    expect(declaredStubGlobals(source)).toEqual(["Leak", "leaked"]);
  });
});

describe("findStubGlobalReferences", () => {
  it("reports a type reference by line, and passes over a member access and a comment", () => {
    const source = `// NodeStdioStream\nconst out = streams.NodeStdioStream;\nexport type Out = NodeStdioStream;`;
    expect(findStubGlobalReferences(source, new Set(["NodeStdioStream"]))).toEqual([{ name: "NodeStdioStream", line: 3 }]);
  });
});

describe("checkStubGlobals", () => {
  it("fails a shipped module naming a global only a stub declares", () => {
    const root = gateFixtureRoot({ ".types/node.d.ts": STUB, "src/cli/types.ts": "export interface Io { stdout: NodeStdioStream }" });
    const outcome = checkStubGlobals(config(root));
    expect({ ok: outcome.ok, first: outcome.findings[0] }).toEqual({
      ok: false,
      first: {
        level: "fail",
        message: "`NodeStdioStream` is declared only by a stub this package does not ship",
        file: "src/cli/types.ts",
        line: 1,
      },
    });
  });

  it("fails a shipped module naming a global a module-form stub declares inside `declare global`", () => {
    const root = gateFixtureRoot({
      ".types/leak.d.ts": "export {};\ndeclare global { interface Leak { a: 1 } }",
      "src/a.ts": "export type A = Leak;",
    });
    expect(checkStubGlobals({ ...config(root), shared: [] }).ok).toBe(false);
  });

  it("passes a global the real runtime types declare too, and a test file naming a stub-only one", () => {
    const root = gateFixtureRoot({
      ".types/node.d.ts": STUB,
      "src/exit.ts": "export const exit = () => process.exit(1);",
      "src/exit.test.ts": "type Out = NodeStdioStream;",
    });
    expect(checkStubGlobals(config(root)).ok).toBe(true);
  });

  it("fails a `shared` entry no stub declares, so the list cannot outlive its stub", () => {
    const root = gateFixtureRoot({ ".types/node.d.ts": STUB, "src/a.ts": "export const a = 1;" });
    expect(checkStubGlobals({ ...config(root), shared: ["process", "Deno"] }).findings.map((finding) => finding.message)).toEqual([
      "`shared` entry `Deno` names no global a stub declares",
    ]);
  });

  it("refuses to report green when no declaration file was found", () => {
    const root = gateFixtureRoot({ "src/a.ts": "export const a = 1;" });
    expect(checkStubGlobals(config(root)).findings[0]?.message).toBe(
      "`.types` matched no declaration file — refusing to report a green stub-globals gate that scanned nothing",
    );
  });

  it("passes over this repository's shipped source", () => {
    const outcome = checkStubGlobals({
      root: process.cwd(),
      stubs: [".types"],
      shared: ["Bun", "Buffer", "ExecutionContext", "ImportMeta", "SubtleCrypto", "process"],
      sources: ["src", "warden/src", "!src/tooling/dev"],
    });
    expect(outcome.findings).toEqual([]);
  });
});
