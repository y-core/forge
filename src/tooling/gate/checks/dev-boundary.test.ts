import { describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { checkDevBoundary, devOnlySpecifiers, isDevEntry } from "./dev-boundary";
import { gateFixtureRoot } from "./gate.fixture";
import type { DevBoundaryCheckConfig } from "./types";

const WRANGLER = '{\n  // the production entry\n  "main": "src/worker.ts",\n}\n';

function project(files: Record<string, string>, config: Partial<DevBoundaryCheckConfig> = {}): DevBoundaryCheckConfig {
  return { root: gateFixtureRoot(files, "forge-dev-"), sources: ["src"], devOnlyDirs: ["src/dev"], ...config };
}

describe("isDevEntry", () => {
  it("derives an entry from the `*.dev.ts` filename, in either extension", () => {
    expect(isDevEntry("src/worker.dev.ts")).toBe(true);
    expect(isDevEntry("src/worker.dev.tsx")).toBe(true);
  });

  it("does not mistake a production entry or a lookalike name for one", () => {
    expect(isDevEntry("src/worker.ts")).toBe(false);
    expect(isDevEntry("src/dev-tools.ts")).toBe(false);
  });

  it("accepts an entry named outside the convention", () => {
    expect(isDevEntry("src/local.ts", ["src/local.ts"])).toBe(true);
  });
});

describe("devOnlySpecifiers", () => {
  it("spells each declared subpath as a consumer would import it", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-dev-"));
    mkdirSync(join(root, "node_modules", "@y-core", "forge"), { recursive: true });
    writeFileSync(join(root, "node_modules", "@y-core", "forge", "package.json"), JSON.stringify({ forge: { devOnly: ["./dev", "./testing"] } }));

    expect(devOnlySpecifiers(root, "@y-core/forge")).toEqual(["@y-core/forge/dev", "@y-core/forge/testing"]);
  });

  it("returns null for a dependency that is absent or declares nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-dev-"));
    mkdirSync(join(root, "node_modules", "silent"), { recursive: true });
    writeFileSync(join(root, "node_modules", "silent", "package.json"), JSON.stringify({ name: "silent" }));

    expect(devOnlySpecifiers(root, "absent")).toBeNull();
    expect(devOnlySpecifiers(root, "silent")).toBeNull();
  });
});

describe("checkDevBoundary — rule A, `main` is not a dev entry", () => {
  it("passes a config whose `main` names the production entry", () => {
    const result = checkDevBoundary(
      project({ "wrangler.jsonc": WRANGLER, "src/worker.ts": "export default {};\n" }, { workerConfig: "wrangler.jsonc" }),
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("1 deployable sources mint no development allowance");
  });

  it("fails a config deploying the development entry, whatever the rest of the tree does", () => {
    const result = checkDevBoundary(
      project(
        { "wrangler.jsonc": '{ "main": "./src/worker.dev.ts" }\n', "src/worker.ts": "export default {};\n" },
        { workerConfig: "wrangler.jsonc" },
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("`main` names the development entry `src/worker.dev.ts`");
  });

  it("fails a config that states no `main` at all", () => {
    const result = checkDevBoundary(
      project({ "wrangler.jsonc": '{ "name": "app" }\n', "src/worker.ts": "export default {};\n" }, { workerConfig: "wrangler.jsonc" }),
    );

    expect(result.findings[0]?.message).toBe(
      "`main` is unstated, and an unstated entry point is one no check can hold to the production/development split",
    );
  });

  it("fails loudly on a missing config rather than passing the rule it cannot read", () => {
    const result = checkDevBoundary(project({ "src/worker.ts": "export default {};\n" }, { workerConfig: "wrangler.jsonc" }));

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("`wrangler.jsonc` not found");
  });

  it("fails loudly on a config it cannot parse", () => {
    const result = checkDevBoundary(
      project({ "wrangler.jsonc": "{ oops\n", "src/worker.ts": "export default {};\n" }, { workerConfig: "wrangler.jsonc" }),
    );

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message.startsWith("`wrangler.jsonc` is not parseable:")).toBe(true);
  });

  it("omits the rule entirely for a repository that deploys no Worker", () => {
    const result = checkDevBoundary(project({ "src/worker.ts": "export default {};\n" }, { workerConfig: null }));

    expect(result.ok).toBe(true);
  });
});

describe("checkDevBoundary — rule B, nothing imports a dev entry", () => {
  it("reports the importer, with the line and the file the specifier resolves to", () => {
    const result = checkDevBoundary(
      project(
        { "src/worker.ts": 'import { extra } from "./worker.dev";\nexport default extra;\n', "src/worker.dev.ts": "export const extra = 1;\n" },
        { workerConfig: null },
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.file).toBe("src/worker.ts");
    expect(result.findings[0]?.line).toBe(1);
    expect(result.findings[0]?.message).toBe("development entry imported — `./worker.dev` resolves to `src/worker.dev.ts`");
  });

  it("allows a spec to import the entry it covers, because a spec is not deployed", () => {
    const result = checkDevBoundary(
      project(
        {
          "src/worker.ts": "export default {};\n",
          "src/worker.dev.ts": "export const extra = 1;\n",
          "src/worker.dev.test.ts": 'import { extra } from "./worker.dev";\nexport const x = extra;\n',
        },
        { workerConfig: null },
      ),
    );

    expect(result.ok).toBe(true);
  });
});

describe("checkDevBoundary — rule C, only a dev entry imports a dev-only module", () => {
  it("reports a production module reaching this repository's own dev-only tree", () => {
    const result = checkDevBoundary(
      project(
        {
          "src/worker.ts": 'import { devAllowance } from "./dev/allowance";\nexport default devAllowance;\n',
          "src/dev/allowance.ts": "export const devAllowance = 1;\n",
        },
        { workerConfig: null },
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("dev-only module imported — `./dev/allowance` resolves to `src/dev/allowance.ts`");
  });

  it("allows a development entry to import one, which is the whole point of the seam", () => {
    const result = checkDevBoundary(
      project(
        {
          "src/worker.dev.ts": 'import { devAllowance } from "./dev/allowance";\nexport default devAllowance;\n',
          "src/dev/allowance.ts": "export const devAllowance = 1;\n",
        },
        { workerConfig: null },
      ),
    );

    expect(result.ok).toBe(true);
  });

  it("allows a type-only import, which is erased and is how a production option names the token", () => {
    const result = checkDevBoundary(
      project(
        {
          "src/worker.ts": 'import type { DevAllowance } from "./dev/allowance";\nexport type Options = { dev?: DevAllowance };\n',
          "src/dev/allowance.ts": "export type DevAllowance = 1;\n",
        },
        { workerConfig: null },
      ),
    );

    expect(result.ok).toBe(true);
  });

  it("reports a forbidden published subpath of a dependency that declares `forge.devOnly`", () => {
    const config = project(
      { "src/worker.ts": 'import { fakeKV } from "@y-core/forge/testing";\nexport default fakeKV;\n' },
      { workerConfig: null },
    );
    mkdirSync(join(config.root, "node_modules", "@y-core", "forge"), { recursive: true });
    writeFileSync(
      join(config.root, "node_modules", "@y-core", "forge", "package.json"),
      JSON.stringify({ forge: { devOnly: ["./testing", "./tooling/*"] } }),
    );

    const result = checkDevBoundary({ ...config, packages: ["@y-core/forge"] });

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("dev-only module imported — `@y-core/forge/testing` resolves to `@y-core/forge/testing`");
  });

  it("matches a wildcard declaration across the subtree it covers", () => {
    const config = project(
      { "src/worker.ts": 'import { checkExports } from "@y-core/forge/tooling/gate";\nexport default checkExports;\n' },
      { workerConfig: null },
    );
    mkdirSync(join(config.root, "node_modules", "@y-core", "forge"), { recursive: true });
    writeFileSync(join(config.root, "node_modules", "@y-core", "forge", "package.json"), JSON.stringify({ forge: { devOnly: ["./tooling/*"] } }));

    expect(checkDevBoundary({ ...config, packages: ["@y-core/forge"] }).ok).toBe(false);
  });

  it("leaves a runtime subpath of the same dependency alone", () => {
    const config = project({ "src/worker.ts": 'import { html } from "@y-core/forge/http";\nexport default html;\n' }, { workerConfig: null });
    mkdirSync(join(config.root, "node_modules", "@y-core", "forge"), { recursive: true });
    writeFileSync(join(config.root, "node_modules", "@y-core", "forge", "package.json"), JSON.stringify({ forge: { devOnly: ["./testing"] } }));

    expect(checkDevBoundary({ ...config, packages: ["@y-core/forge"] }).ok).toBe(true);
  });

  it("fails loudly when a named dependency declares no forbidden list, which would forbid nothing", () => {
    const result = checkDevBoundary(project({ "src/worker.ts": "export default {};\n" }, { workerConfig: null, packages: ["@y-core/forge"] }));

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("`@y-core/forge` declares no `forge.devOnly` subpaths");
  });
});

describe("checkDevBoundary — the negative fixture", () => {
  // A check proven only against passing input is a check that has never failed. The fixture is a
  // real Worker tree, copied out so the fake dependency manifest can sit beside it.
  it("reports exactly one finding per rule against a Worker that breaks all three", () => {
    const fixture = resolve(import.meta.dir, "../../../../tests/fixtures/dev-boundary-consumer");
    const root = mkdtempSync(join(tmpdir(), "forge-dev-fixture-"));
    cpSync(fixture, root, { recursive: true });
    mkdirSync(join(root, "node_modules", "@y-core", "forge"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "@y-core", "forge", "package.json"),
      JSON.stringify({ name: "@y-core/forge", forge: { devOnly: ["./dev", "./testing", "./tooling/*"] } }),
    );

    const result = checkDevBoundary({ root, sources: ["src"], workerConfig: "wrangler.jsonc", packages: ["@y-core/forge"] });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`main` names the development entry `src/worker.dev.ts`",
      "dev-only module imported — `@y-core/forge/testing` resolves to `@y-core/forge/testing`",
      "development entry imported — `./worker.dev` resolves to `src/worker.dev.ts`",
    ]);
  });
});

describe("checkDevBoundary — the derivation", () => {
  it("rejects a `devEntries` entry that only restates the `*.dev.ts` convention", () => {
    const result = checkDevBoundary(
      project({ "src/worker.dev.ts": "export const extra = 1;\n" }, { workerConfig: null, devEntries: ["src/worker.dev.ts"] }),
    );

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("`devEntries` lists `src/worker.dev.ts`, which the `*.dev.ts` convention already derives");
  });

  it("refuses a green verdict when the source directory holds nothing", () => {
    const result = checkDevBoundary(project({}, { workerConfig: null }));

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("`src` matched no source — refusing to report a green dev-boundary gate that scanned nothing");
  });
});
