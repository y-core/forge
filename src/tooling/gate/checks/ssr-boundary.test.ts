import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { fail } from "../finding";
import { boundaryViolation, checkSsrBoundary, validateSsrBoundary } from "./ssr-boundary";

const CONFIG = { clientDirs: ["src/ui/client", "src/auth/client"], entryPoints: ["client.ts"] } as const;

const violations = (file: string, source: string) => validateSsrBoundary(file, source, CONFIG);

describe("boundaryViolation", () => {
  it("clears a file inside the client directory, which owns the runtime", () => {
    expect(boundaryViolation("src/ui/client/signal.ts", CONFIG)).toBe(null);
    expect(boundaryViolation("src/ui/client/nested/deep.ts", CONFIG)).toBe(null);
  });

  it("clears a registration entry point, which exists to pull the runtime in", () => {
    expect(boundaryViolation("src/ui/core/client.ts", CONFIG)).toBe(null);
    expect(boundaryViolation("src/ui/chrome/client.ts", CONFIG)).toBe(null);
  });

  it("refuses a .tsx entry point too: rendering markup means running in the Worker", () => {
    expect(boundaryViolation("src/ui/core/client.tsx", CONFIG)).toContain("renders on the server");
  });

  it("refuses an ordinary module outside the client directory", () => {
    expect(boundaryViolation("src/ui/core/utils/cn.ts", CONFIG)).toContain("only `client.ts`");
  });

  it("does not mistake a sibling directory with the same prefix for the client one", () => {
    expect(boundaryViolation("src/ui/client-helpers/thing.ts", CONFIG)).toContain("only `client.ts`");
  });
});

describe("validateSsrBoundary", () => {
  it("reports a component importing the browser runtime, naming the file, reason and line", () => {
    const findings = violations("src/ui/core/button.tsx", '/** doc */\nimport { effect } from "../client/signal";\n');

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("src/ui/core/button.tsx");
    expect(findings[0]?.detail).toEqual([
      "a `.tsx` file renders on the server, so it may never import the browser runtime",
      "line 2: `../client/signal`",
    ]);
  });

  it("passes a component that imports only contracts and siblings", () => {
    expect(
      violations("src/ui/core/button.tsx", 'import { cn } from "./utils/cn";\nimport { stateAttrs } from "../contracts/state-attrs";\n'),
    ).toEqual([]);
  });

  it("passes the registration entry point doing exactly what it exists to do", () => {
    expect(violations("src/ui/core/client.ts", 'import { registerScope } from "../client/resume";\n')).toEqual([]);
  });

  it("passes a type-only import, which is erased before any bundle sees it", () => {
    expect(violations("src/ui/core/button.tsx", 'import type { Signal } from "../client/signal";\n')).toEqual([]);
  });

  it("reports every crossing in one finding rather than one finding each", () => {
    const findings = violations("src/ui/core/button.tsx", 'import "../client/signal";\nimport "../client/dom";\n');

    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toHaveLength(3);
  });

  it("ignores a bare package specifier, which resolves to no file in this tree", () => {
    expect(violations("src/ui/core/button.tsx", 'import { x } from "@y-core/forge/ui/client";\n')).toEqual([]);
  });
});

describe("checkSsrBoundary() — the walk and its vacuity refusal", () => {
  function fixtureRoot(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "forge-ssr-boundary-"));
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), source, "utf-8");
    }
    return root;
  }

  const config = (root: string) => ({ root, sources: ["src/ui"], clientDirs: ["src/ui/client"], entryPoints: ["client.ts"] });

  it("passes a tree whose imports respect the boundary, and counts what it walked", () => {
    const result = checkSsrBoundary(config(fixtureRoot({ "src/ui/core/button.ts": "export const b = 1;\n" })));

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("1 files respect the src/ui/client boundary");
  });

  it("refuses a walk that matched no source, rather than reporting a green gate over nothing", () => {
    const result = checkSsrBoundary(config(fixtureRoot({ "README.md": "# forge\n" })));

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([fail("`src/ui` matched no source — refusing to report a green ssr-boundary gate that scanned nothing")]);
    expect(result.summary).toBe("");
  });
});
