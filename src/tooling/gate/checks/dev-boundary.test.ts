import { afterAll, describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { checkDevBoundary, devOnlySpecifiers, isDevModule } from "./dev-boundary";
import { gateFixtureRoot } from "./gate.fixture";
import type { DevBoundaryCheckConfig } from "./types";

const WRANGLER = '{\n  "name": "app",\n  // the production entry\n  "main": "src/worker.ts",\n}\n';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>, config: Partial<DevBoundaryCheckConfig> = {}): DevBoundaryCheckConfig {
  const root = gateFixtureRoot(files, "forge-dev-");
  roots.push(root);
  return { root, sources: ["src"], devOnlyDirs: ["src/dev"], ...config };
}

describe("isDevModule", () => {
  it("derives a development module from the `*.dev.ts` suffix, in either extension", () => {
    expect(isDevModule("src/worker.dev.ts")).toBe(true);
    expect(isDevModule("src/controllers/logs.dev.tsx")).toBe(true);
  });

  it("does not mistake a production module or a lookalike name for one", () => {
    expect(isDevModule("src/worker.ts")).toBe(false);
    expect(isDevModule("src/dev-tools.ts")).toBe(false);
    expect(isDevModule("src/security/dev-allowance.ts")).toBe(false);
  });
});

describe("devOnlySpecifiers", () => {
  it("spells each declared subpath as a consumer would import it", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-dev-"));
    roots.push(root);
    mkdirSync(join(root, "node_modules", "@y-core", "forge"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "@y-core", "forge", "package.json"),
      JSON.stringify({ forge: { devOnly: ["./testing", "./tooling/*"] } }),
    );

    expect(devOnlySpecifiers(root, "@y-core/forge")).toEqual(["@y-core/forge/testing", "@y-core/forge/tooling/*"]);
  });

  it("returns null for a dependency that is absent or declares nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-dev-"));
    roots.push(root);
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
    expect(result.summary).toBe("1 deployable sources reach no development code");
  });

  it("fails a config deploying the development entry, whatever the rest of the tree does", () => {
    const result = checkDevBoundary(
      project(
        { "wrangler.jsonc": '{ "name": "app", "main": "./src/worker.dev.ts" }\n', "src/worker.ts": "export default {};\n" },
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

  it("fails loudly on a config that names no Worker, as one it cannot parse", () => {
    const root = gateFixtureRoot({ "wrangler.jsonc": '{ "main": "src/worker.ts" }\n', "src/worker.ts": "export default {};\n" }, "forge-dev-");
    roots.push(root);
    const result = checkDevBoundary({ root, sources: ["src"], devOnlyDirs: ["src/dev"], workerConfig: "wrangler.jsonc" });

    expect([result.ok, result.findings.length]).toEqual([false, 1]);
    expect(
      result.findings[0]?.message.startsWith(
        `\`wrangler.jsonc\` is not parseable: malformed wrangler config at ${resolve(root, "wrangler.jsonc")}: name:`,
      ),
    ).toBe(true);
  });

  it("omits the rule entirely for a repository that deploys no Worker", () => {
    const result = checkDevBoundary(project({ "src/worker.ts": "export default {};\n" }, { workerConfig: null }));

    expect(result.ok).toBe(true);
  });
});

describe("checkDevBoundary — rule B, no production module imports a dev one", () => {
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
    expect(result.findings[0]?.message).toBe("development module imported — `./worker.dev` resolves to `src/worker.dev.ts`");
  });

  it("reports a production import of a relaxation beside its concern, with the file and line", () => {
    const result = checkDevBoundary(
      project(
        { "src/worker.ts": 'export default {};\nimport { x } from "./form/x.dev";\n', "src/form/x.dev.ts": "export const x = 1;\n" },
        { workerConfig: null },
      ),
    );

    expect(result.findings.map((finding) => [finding.file, finding.line, finding.message])).toEqual([
      ["src/worker.ts", 2, "development module imported — `./form/x.dev` resolves to `src/form/x.dev.ts`"],
    ]);
  });

  it("reports a type-only import of a development module, so production names nothing from one", () => {
    const result = checkDevBoundary(
      project(
        { "src/worker.ts": 'import type { X } from "./x.dev";\nexport type Y = X;\n', "src/x.dev.ts": "export type X = 1;\n" },
        { workerConfig: null },
      ),
    );

    expect(result.findings.map((finding) => finding.message)).toEqual(["development module imported — `./x.dev` resolves to `src/x.dev.ts`"]);
  });

  it("resolves a `.dev.tsx` module", () => {
    const result = checkDevBoundary(
      project(
        { "src/worker.ts": 'import { Logs } from "./logs.dev";\nexport default Logs;\n', "src/logs.dev.tsx": "export const Logs = 1;\n" },
        { workerConfig: null },
      ),
    );

    expect(result.findings.map((finding) => finding.message)).toEqual([
      "development module imported — `./logs.dev` resolves to `src/logs.dev.tsx`",
    ]);
  });

  it("allows one development module to import another", () => {
    const result = checkDevBoundary(
      project(
        {
          "src/worker.ts": "export default {};\n",
          "src/a.dev.ts": 'import { b } from "./b.dev";\nexport const a = b;\n',
          "src/b.dev.ts": "export const b = 1;\n",
        },
        { workerConfig: null },
      ),
    );

    expect(result.ok).toBe(true);
  });

  it("allows a dev-only directory to import a development module", () => {
    const result = checkDevBoundary(
      project(
        {
          "src/worker.ts": "export default {};\n",
          "src/dev/mint.ts": 'import { b } from "../b.dev";\nexport const a = b;\n',
          "src/b.dev.ts": "export const b = 1;\n",
        },
        { workerConfig: null },
      ),
    );

    expect(result.ok).toBe(true);
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

describe("checkDevBoundary — rule C, only a dev module imports a dev-only one", () => {
  it("reports a production module reaching this repository's own dev-only tree", () => {
    const result = checkDevBoundary(
      project(
        {
          "src/worker.ts": 'import { grant } from "./dev/allowance";\nexport default grant;\n',
          "src/dev/allowance.ts": "export const grant = 1;\n",
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
          "src/worker.dev.ts": 'import { grant } from "./dev/allowance";\nexport default grant;\n',
          "src/dev/allowance.ts": "export const grant = 1;\n",
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
          "src/worker.ts": 'import type { Grant } from "./dev/allowance";\nexport type Options = { dev?: Grant };\n',
          "src/dev/allowance.ts": "export type Grant = 1;\n",
        },
        { workerConfig: null },
      ),
    );

    expect(result.ok).toBe(true);
  });

  it("does not scan a `*.fixture.ts`, which is excluded from `files` and so is never deployed", () => {
    const result = checkDevBoundary(
      project(
        {
          "src/worker.ts": "export default {};\n",
          "src/thing.fixture.ts": 'import { grant } from "./dev/allowance";\nexport const fixed = grant;\n',
          "src/dev/allowance.ts": "export const grant = 1;\n",
        },
        { workerConfig: null },
      ),
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("1 deployable sources reach no development code");
  });

  it("reports the same import from a production module, so the fixture exemption is the suffix and nothing else", () => {
    const result = checkDevBoundary(
      project(
        {
          "src/thing.ts": 'import { grant } from "./dev/allowance";\nexport const fixed = grant;\n',
          "src/dev/allowance.ts": "export const grant = 1;\n",
        },
        { workerConfig: null },
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("dev-only module imported — `./dev/allowance` resolves to `src/dev/allowance.ts`");
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
    const config = project({ "src/worker.ts": 'import { html } from "@y-core/forge/html";\nexport default html;\n' }, { workerConfig: null });
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

describe("checkDevBoundary — a `#` specifier through the `imports` map", () => {
  const manifest = (imports: Record<string, unknown>): string => JSON.stringify({ name: "app", imports });
  const findings = (config: DevBoundaryCheckConfig) =>
    checkDevBoundary(config).findings.map((finding) => [finding.file, finding.line, finding.message]);

  it("fails an entry whose `default` is a development module, on the manifest, naming key and target", () => {
    const config = project(
      {
        "package.json": manifest({ "#relax/cop": { default: "./src/cop.dev.ts" } }),
        "src/worker.ts": "export default {};\n",
        "src/cop.dev.ts": "export const cop = 1;\n",
      },
      { workerConfig: null },
    );

    expect(findings(config)).toEqual([["package.json", undefined, "`imports` entry `#relax/cop` deploys the development module `src/cop.dev.ts`"]]);
  });

  it("fails a production importer of that entry, at the line of the specifier", () => {
    const config = project(
      {
        "package.json": manifest({ "#relax/cop": { default: "./src/cop.dev.ts" } }),
        "src/worker.ts": 'export default {};\nimport { cop } from "#relax/cop";\n',
        "src/cop.dev.ts": "export const cop = 1;\n",
      },
      { workerConfig: null },
    );

    expect(findings(config)).toEqual([
      ["package.json", undefined, "`imports` entry `#relax/cop` deploys the development module `src/cop.dev.ts`"],
      ["src/worker.ts", 2, "development module imported — `#relax/cop` resolves to `src/cop.dev.ts`"],
    ]);
  });

  it("fails a `*` entry whose deployed target is a development module, for the importer's own match", () => {
    const config = project(
      {
        "package.json": manifest({ "#relax/*": { workerd: "./src/relax/*.dev.ts", default: "./src/relax/*.ts" } }),
        "src/worker.ts": 'import { cop } from "#relax/cop";\nexport default cop;\n',
        "src/relax/cop.dev.ts": "export const cop = 1;\n",
        "src/relax/cop.ts": "export const cop = 0;\n",
      },
      { workerConfig: null },
    );

    expect(findings(config)).toEqual([
      ["package.json", undefined, "`imports` entry `#relax/*` deploys the development module `src/relax/*.dev.ts`"],
      ["src/worker.ts", 1, "development module imported — `#relax/cop` resolves to `src/relax/cop.dev.ts`"],
    ]);
  });

  it("passes forge's own shape, the development module behind `forge-dev` and the strict one under `default`", () => {
    const result = checkDevBoundary(
      project(
        {
          "package.json": manifest({ "#relax/cop": { "forge-dev": "./src/cop.dev.ts", default: "./src/cop.strict.ts" } }),
          "src/worker.ts": 'import { cop } from "#relax/cop";\nexport default cop;\n',
          "src/cop.dev.ts": "export const cop = 1;\n",
          "src/cop.strict.ts": "export const cop = 0;\n",
        },
        { workerConfig: null },
      ),
    );

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("fails the same entry once a condition the deployed bundle sets is written before `default`", () => {
    const config = project(
      {
        "package.json": manifest({ "#relax/cop": { workerd: "./src/cop.dev.ts", default: "./src/cop.strict.ts" } }),
        "src/worker.ts": 'import { cop } from "#relax/cop";\nexport default cop;\n',
        "src/cop.dev.ts": "export const cop = 1;\n",
        "src/cop.strict.ts": "export const cop = 0;\n",
      },
      { workerConfig: null },
    );

    expect(findings(config)).toEqual([
      ["package.json", undefined, "`imports` entry `#relax/cop` deploys the development module `src/cop.dev.ts`"],
      ["src/worker.ts", 1, "development module imported — `#relax/cop` resolves to `src/cop.dev.ts`"],
    ]);
  });

  it("fails a production importer of an entry whose deployed target is in a dev-only tree", () => {
    const config = project(
      {
        "package.json": manifest({ "#grant": "./src/dev/allowance.ts" }),
        "src/worker.ts": 'import { grant } from "#grant";\nexport default grant;\n',
        "src/dev/allowance.ts": "export const grant = 1;\n",
      },
      { workerConfig: null },
    );

    expect(findings(config)).toEqual([["src/worker.ts", 1, "dev-only module imported — `#grant` resolves to `src/dev/allowance.ts`"]]);
  });

  it("passes an entry reaching a dev-only tree only under a condition the deployed bundle never sets", () => {
    const result = checkDevBoundary(
      project(
        {
          "package.json": manifest({ "#grant": { "forge-dev": "./src/dev/allowance.ts", default: "./src/grant.ts" } }),
          "src/worker.ts": 'import { grant } from "#grant";\nexport default grant;\n',
          "src/grant.ts": "export const grant = 0;\n",
          "src/dev/allowance.ts": "export const grant = 1;\n",
        },
        { workerConfig: null },
      ),
    );

    expect(result.findings).toEqual([]);
  });

  it("ignores a `#` specifier no entry resolves, as it ignores a bare one", () => {
    const result = checkDevBoundary(
      project(
        {
          "package.json": manifest({ "#relax/cop": { "forge-dev": "./src/cop.dev.ts", default: "./src/cop.strict.ts" } }),
          "src/worker.ts": 'import { x } from "#unmapped/dev";\nimport { y } from "#relax/other";\nexport default [x, y];\n',
          "src/cop.strict.ts": "export const cop = 0;\n",
        },
        { workerConfig: null },
      ),
    );

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("checkDevBoundary — the `dev-bundle-consumer` fixture's `#app/relax`", () => {
  function consumer(imports?: Record<string, unknown>): string {
    const root = mkdtempSync(join(tmpdir(), "forge-dev-consumer-"));
    roots.push(root);
    cpSync(resolve(import.meta.dir, "../../../../tests/fixtures/dev-bundle-consumer"), root, { recursive: true });
    if (imports !== undefined) writeFileSync(join(root, "package.json"), JSON.stringify({ name: "dev-bundle-consumer", imports }));
    return root;
  }

  const messages = (root: string, config: Partial<DevBoundaryCheckConfig> = {}): string[] =>
    checkDevBoundary({ root, sources: ["src"], workerConfig: "wrangler.jsonc", ...config }).findings.map((finding) => finding.message);

  it("reports only the fixture's direct `./grant.dev` import, leaving the strict-by-default entry alone", () => {
    expect(messages(consumer())).toEqual(["development module imported — `./grant.dev` resolves to `src/grant.dev.ts`"]);
  });

  it("reports the entry and its importer once `default` names the development banner", () => {
    const root = consumer({ "#app/relax": { "forge-dev": "./src/app/relax.strict.ts", default: "./src/app/relax.dev.ts" } });

    expect(messages(root)).toEqual([
      "`imports` entry `#app/relax` deploys the development module `src/app/relax.dev.ts`",
      "development module imported — `#app/relax` resolves to `src/app/relax.dev.ts`",
      "development module imported — `./grant.dev` resolves to `src/grant.dev.ts`",
    ]);
  });

  it("reports no second relaxation alias once the rule names `#app/relax`", () => {
    expect(messages(consumer(), { relaxAlias: "#app/relax" })).toEqual([
      "development module imported — `./grant.dev` resolves to `src/grant.dev.ts`",
    ]);
  });
});

describe("checkDevBoundary — the one relaxation alias", () => {
  const RELAX = { "forge-dev": "./src/app/relax.dev.ts", default: "./src/app/relax.strict.ts" };
  const findings = (imports: Record<string, unknown>, config: Partial<DevBoundaryCheckConfig> = { relaxAlias: "#app/relax" }) =>
    checkDevBoundary(
      project(
        { "package.json": JSON.stringify({ name: "app", imports }), "src/worker.ts": "export default {};\n" },
        { workerConfig: null, ...config },
      ),
    ).findings.map((finding) => [finding.file, finding.message]);

  it("fails a second key routing `forge-dev`, once, on the manifest, naming the key", () => {
    expect(findings({ "#app/relax": RELAX, "#app/debug-banner": RELAX })).toEqual([
      ["package.json", "`imports` entry `#app/debug-banner` routes `forge-dev` through a second relaxation alias"],
    ]);
  });

  it("passes the relaxation alias alone", () => {
    expect(findings({ "#app/relax": RELAX })).toEqual([]);
  });

  it("fails `forge-dev` nested under another condition", () => {
    expect(findings({ "#app/debug-banner": { workerd: RELAX } })).toEqual([
      ["package.json", "`imports` entry `#app/debug-banner` routes `forge-dev` through a second relaxation alias"],
    ]);
  });

  it("passes a key that carries no `forge-dev`", () => {
    expect(findings({ "#app/relax": RELAX, "#app/db": { default: "./src/db.ts" } })).toEqual([]);
  });

  it("fails a `*` key under the alias, which is a second alias by its exact key", () => {
    expect(findings({ "#app/relax/*": { "forge-dev": "./src/app/*.dev.ts", default: "./src/app/*.strict.ts" } })).toEqual([
      ["package.json", "`imports` entry `#app/relax/*` routes `forge-dev` through a second relaxation alias"],
    ]);
  });

  it("passes forge's own `#relax/*` keys when no alias is named, so forge's gate is unaffected", () => {
    const own = {
      "#relax/cop": { "forge-dev": "./src/cop.dev.ts", default: "./src/cop.strict.ts" },
      "#relax/origin": { "forge-dev": "./src/origin.dev.ts", default: "./src/origin.strict.ts" },
    };

    expect(findings(own, {})).toEqual([]);
  });
});

describe("checkDevBoundary — the negative fixture", () => {
  // A check proven only against passing input is a check that has never failed. The fixture is a
  // real Worker tree, copied out so the fake dependency manifest can sit beside it.
  it("reports exactly one finding per rule against a Worker that breaks all three", () => {
    const fixture = resolve(import.meta.dir, "../../../../tests/fixtures/dev-boundary-consumer");
    const root = mkdtempSync(join(tmpdir(), "forge-dev-fixture-"));
    roots.push(root);
    cpSync(fixture, root, { recursive: true });
    mkdirSync(join(root, "node_modules", "@y-core", "forge"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "@y-core", "forge", "package.json"),
      JSON.stringify({ name: "@y-core/forge", forge: { devOnly: ["./testing", "./tooling/*"] } }),
    );

    const result = checkDevBoundary({ root, sources: ["src"], workerConfig: "wrangler.jsonc", packages: ["@y-core/forge"] });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`main` names the development entry `src/worker.dev.ts`",
      "dev-only module imported — `@y-core/forge/testing` resolves to `@y-core/forge/testing`",
      "development module imported — `./worker.dev` resolves to `src/worker.dev.ts`",
    ]);
  });
});

describe("checkDevBoundary — the derivation", () => {
  it("refuses a green verdict when the source directory holds nothing", () => {
    const result = checkDevBoundary(project({}, { workerConfig: null }));

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("`src` matched no source — refusing to report a green dev-boundary gate that scanned nothing");
  });

  it("fails on a `sources` entry naming no directory, even beside one that finds files", () => {
    const result = checkDevBoundary(project({ "src/a.ts": "export const a = 1;\n" }, { workerConfig: null, sources: ["src", "srcc"] }));

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["`sources` entry `srcc` names no directory under the root"]);
  });
});
