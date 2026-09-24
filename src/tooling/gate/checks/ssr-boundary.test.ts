import { describe, expect, it } from "bun:test";

import { fail } from "../finding";
import { gateFixtureRoot } from "./gate.fixture";
import { boundaryViolation, checkSsrBoundary, clientSubpaths, validateSsrBoundary } from "./ssr-boundary";

const CONFIG = { clientDirs: ["src/ui/client", "src/auth/client"], entryPoints: ["client.ts"] } as const;

// A subpath inside a client directory, one whose target is a registration entry point outside every
// client directory, and one that stays on the server.
const EXPORTS = {
  "./http": { import: "./src/http/mod.ts", types: "./src/http/mod.ts" },
  "./ui/client": { import: "./src/ui/client/mod.ts", types: "./src/ui/client/mod.ts" },
  "./ui/core/client": { import: "./src/ui/core/client.ts", types: "./src/ui/core/client.ts" },
};

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

  it("ignores a third party's bare specifier, which names no client subpath of this package", () => {
    expect(violations("src/ui/core/button.tsx", 'import { x } from "valibot";\nimport { y } from "@remix-run/headers";\n')).toEqual([]);
  });
});

// A self-import by published subpath resolves to no relative file, so `resolveSpecifier` answers
// `null` for it exactly as it does for a third party's — the manifest is what tells the two apart.
describe("validateSsrBoundary — a self-import by published subpath", () => {
  const published = { ...CONFIG, packageName: "@y-core/forge", exports: EXPORTS } as const;
  const judge = (file: string, source: string) => validateSsrBoundary(file, source, published);

  it("reports a component reaching the browser runtime through the package's own name", () => {
    const findings = judge("src/ui/core/button.tsx", 'import { mount } from "@y-core/forge/ui/core/client";\n');

    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toEqual([
      "a `.tsx` file renders on the server, so it may never import the browser runtime",
      "line 1: `@y-core/forge/ui/core/client`",
    ]);
  });

  it("reports a subpath whose target is inside a client directory as readily as an entry point's", () => {
    expect(judge("src/ui/core/button.tsx", 'import { signal } from "@y-core/forge/ui/client";\n')).toHaveLength(1);
  });

  it("still passes a third party's bare specifier, which no published subpath names", () => {
    expect(judge("src/ui/core/button.tsx", 'import { x } from "valibot";\n')).toEqual([]);
  });

  it("still passes a published subpath that stays on the server", () => {
    expect(judge("src/ui/core/button.tsx", 'import { html } from "@y-core/forge/http";\n')).toEqual([]);
  });

  it("still passes a type-only self-import, which is erased before any bundle sees it", () => {
    expect(judge("src/ui/core/button.tsx", 'import type { Signal } from "@y-core/forge/ui/client";\n')).toEqual([]);
  });
});

describe("clientSubpaths", () => {
  it("collects a subpath inside a client directory and one whose target is a registration entry point", () => {
    const found = clientSubpaths({ ...CONFIG, packageName: "@y-core/forge", exports: EXPORTS });

    expect(found.get("@y-core/forge/ui/client")).toBe("src/ui/client/mod.ts");
    expect(found.get("@y-core/forge/ui/core/client")).toBe("src/ui/core/client.ts");
    expect(found.has("@y-core/forge/http")).toBe(false);
  });

  it("collects nothing when the manifest was not supplied, which is what keeps the rule opt-in", () => {
    expect(clientSubpaths(CONFIG).size).toBe(0);
  });
});

describe("checkSsrBoundary() — the walk and its vacuity refusal", () => {
  const fixtureRoot = (files: Record<string, string>): string => gateFixtureRoot(files, "forge-ssr-boundary-");

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

  it("fails on a `sources` entry naming no directory, even beside one that finds files", () => {
    const root = fixtureRoot({ "src/ui/core/button.ts": "export const b = 1;\n" });
    const result = checkSsrBoundary({ ...config(root), sources: ["src/ui", "src/auth"] });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["`sources` entry `src/auth` names no directory under the root"]);
  });

  it("reports a server file that imports the browser runtime, from a subdirectory the walk must descend into", () => {
    const root = fixtureRoot({
      "src/ui/client/signal.ts": "export const signal = 1;\n",
      "src/ui/server/deep/nested/panel.ts": 'import { signal } from "../../../client/signal";\nexport const panel = signal;\n',
    });

    const result = checkSsrBoundary(config(root));

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.file)).toEqual(["src/ui/server/deep/nested/panel.ts"]);
    expect(result.findings[0]?.detail?.at(-1)).toBe("line 1: `../../../client/signal`");
  });

  it("does not scan a spec or a `*.fixture.ts`, neither of which the tarball carries", () => {
    const root = fixtureRoot({
      "src/ui/client/signal.ts": "export const signal = 1;\n",
      "src/ui/server/panel.test.ts": 'import { signal } from "../client/signal";\nexport const a = signal;\n',
      "src/ui/server/panel.fixture.ts": 'import { signal } from "../client/signal";\nexport const b = signal;\n',
    });

    const result = checkSsrBoundary(config(root));

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("1 files respect the src/ui/client boundary");
  });

  it("passes the same nested file when the crossing import is type-only, which is erased at emit", () => {
    const root = fixtureRoot({
      "src/ui/client/signal.ts": "export type Signal = number;\n",
      "src/ui/server/deep/nested/panel.ts": 'import type { Signal } from "../../../client/signal";\nexport const panel = (s: Signal) => s;\n',
    });

    expect(checkSsrBoundary(config(root)).findings).toEqual([]);
  });
});
