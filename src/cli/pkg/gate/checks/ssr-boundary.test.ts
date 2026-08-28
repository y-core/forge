import { describe, expect, it } from "bun:test";
import { boundaryViolation, validateSsrBoundary } from "./ssr-boundary";

const CONFIG = { clientDir: "src/ui/client", entryPoints: ["client.ts"] } as const;

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
