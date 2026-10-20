import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { DEV_CONDITION, WRANGLER_CONDITIONS } from "../../cf/dev/conditions";
import { bundleWorker, checkDevBundle, workerBuildOptions } from "./dev-bundle";
import { gateFixtureRoot } from "./gate.fixture";
import type { BundleMetafile, DevBundleCheckConfig } from "./types";

const WRANGLER = '{ "name": "app", "main": "src/worker.ts" }\n';

const FORGE_MANIFEST = {
  name: "@y-core/forge",
  exports: {
    "./app": { import: "./src/app/mod.ts" },
    "./testing": { import: "./src/testing/mod.ts" },
    "./testing/node": { types: "./src/testing/node.d.ts" },
    "./tooling/gate": { import: "./src/tooling/gate/mod.ts" },
  },
  forge: { devOnly: ["./testing", "./testing/node", "./tooling/*"] },
};

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function installForge(root: string, manifest: object = FORGE_MANIFEST): void {
  const dir = join(root, "node_modules", "@y-core", "forge");
  for (const sub of ["app", "testing", "tooling/gate"]) mkdirSync(join(dir, "src", sub), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "src", "app", "mod.ts"), 'export function createApp(): string {\n  return "app";\n}\n');
  writeFileSync(join(dir, "src", "testing", "mod.ts"), "export function fakeKV(): object {\n  return {};\n}\n");
}

function project(files: Record<string, string>, config: Partial<DevBundleCheckConfig> = {}): DevBundleCheckConfig {
  const root = gateFixtureRoot({ "wrangler.jsonc": WRANGLER, ...files }, "forge-dev-bundle-");
  roots.push(root);
  installForge(root);
  return { root, packages: ["@y-core/forge"], ...config };
}

function metafile(inputs: Record<string, number>): BundleMetafile {
  return {
    outputs: { "out.js": { inputs: Object.fromEntries(Object.entries(inputs).map(([path, bytesInOutput]) => [path, { bytesInOutput }])) } },
  };
}

const messages = (result: { findings: readonly { message: string }[] }): string[] => result.findings.map((finding) => finding.message);

describe("checkDevBundle — the judgement, over a fixed metafile", () => {
  it("passes a bundle that holds production modules alone", async () => {
    const config = project({ "src/worker.ts": "export default {};\n" });
    const result = await checkDevBundle({
      ...config,
      bundler: async () => metafile({ "src/worker.ts": 40, "node_modules/@y-core/forge/src/app/mod.ts": 30 }),
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("src/worker.ts bundles 2 modules, none of them development code");
  });

  it("fails a module under a directory a dev-only subpath is published from", async () => {
    const config = project({ "src/worker.ts": "export default {};\n" });
    const result = await checkDevBundle({ ...config, bundler: async () => metafile({ "node_modules/@y-core/forge/src/testing/mod.ts": 12 }) });

    expect(messages(result)).toEqual(["development code in the deployed bundle — `node_modules/@y-core/forge/src/testing/mod.ts`"]);
  });

  it("covers a wildcard declaration through every export it matches", async () => {
    const config = project({ "src/worker.ts": "export default {};\n" });
    const result = await checkDevBundle({ ...config, bundler: async () => metafile({ "node_modules/@y-core/forge/src/tooling/gate/mod.ts": 12 }) });

    expect(result.ok).toBe(false);
  });

  it("ignores a module listed with no bytes in the output, which tree-shaking removed", async () => {
    const config = project({ "src/worker.ts": "export default {};\n" });
    const result = await checkDevBundle({ ...config, bundler: async () => metafile({ "node_modules/@y-core/forge/src/testing/mod.ts": 0 }) });

    expect(result.ok).toBe(true);
  });

  it("ignores an input carrying a namespace prefix, which is no file", async () => {
    const config = project({ "src/worker.ts": "export default {};\n" });
    const result = await checkDevBundle({ ...config, bundler: async () => metafile({ "dataurl:src/testing/mod.ts": 12 }) });

    expect(result.ok).toBe(true);
  });

  it("fails a development module wherever it sits, the project's own or a dependency's", async () => {
    const config = project({ "src/worker.ts": "export default {};\n" });
    const result = await checkDevBundle({
      ...config,
      bundler: async () =>
        metafile({ "src/worker.dev.ts": 5, "src/controllers/logs.dev.tsx": 5, "node_modules/@y-core/forge/src/form/turnstile.dev.ts": 5 }),
    });

    expect(messages(result)).toEqual([
      "development code in the deployed bundle — `src/worker.dev.ts`",
      "development code in the deployed bundle — `src/controllers/logs.dev.tsx`",
      "development code in the deployed bundle — `node_modules/@y-core/forge/src/form/turnstile.dev.ts`",
    ]);
  });

  it("follows a symlinked install to the real directory esbuild reports, as `dev:forge` can leave one", async () => {
    const checkout = mkdtempSync(join(tmpdir(), "forge-dev-bundle-link-"));
    roots.push(checkout);
    installForge(checkout);
    const root = gateFixtureRoot({ "wrangler.jsonc": WRANGLER }, "forge-dev-bundle-");
    roots.push(root);
    mkdirSync(join(root, "node_modules", "@y-core"), { recursive: true });
    symlinkSync(join(checkout, "node_modules", "@y-core", "forge"), join(root, "node_modules", "@y-core", "forge"));
    const reported = relative(root, join(checkout, "node_modules", "@y-core", "forge", "src", "testing", "mod.ts"));
    const result = await checkDevBundle({ root, packages: ["@y-core/forge"], bundler: async () => metafile({ [reported]: 12 }) });

    expect(messages(result)).toEqual([`development code in the deployed bundle — \`${reported}\``]);
  });
});

describe("checkDevBundle — what it refuses to judge", () => {
  it("refuses a worker config that sets a key changing what wrangler bundles", async () => {
    const config = project({ "wrangler.jsonc": '{ "name": "app", "main": "src/worker.ts", "alias": { "a": "./b" }, "rules": [] }\n' });
    const result = await checkDevBundle({ ...config, bundler: async () => metafile({}) });

    expect(messages(result)).toEqual([
      "`alias` is set, and the dev-bundle check does not model it",
      "`rules` is set, and the dev-bundle check does not model it",
    ]);
  });

  it("refuses a worker config that sets `define`, which rewrites the bundle", async () => {
    const config = project({ "wrangler.jsonc": '{ "name": "app", "main": "src/worker.ts", "define": { "X": "1" } }\n' });
    const result = await checkDevBundle({ ...config, bundler: async () => metafile({}) });

    expect(messages(result)).toEqual(["`define` is set, and the dev-bundle check does not model it"]);
  });

  it("refuses `nodejs_compat` rather than failing a bare Node built-in the real bundle cannot resolve", async () => {
    const config = project({
      "wrangler.jsonc": '{ "name": "app", "main": "src/worker.ts", "compatibility_flags": ["nodejs_compat"] }\n',
      "src/worker.ts": 'import { EventEmitter } from "events";\nexport default { emitter: new EventEmitter() };\n',
    });

    expect(messages(await checkDevBundle(config))).toEqual([
      "`compatibility_flags` carries `nodejs_compat`, and the dev-bundle check does not model it",
    ]);
  });

  it("refuses `nodejs_compat_v2`", async () => {
    const config = project({ "wrangler.jsonc": '{ "name": "app", "main": "src/worker.ts", "compatibility_flags": ["nodejs_compat_v2"] }\n' });
    const result = await checkDevBundle({ ...config, bundler: async () => metafile({}) });

    expect(messages(result)).toEqual(["`compatibility_flags` carries `nodejs_compat_v2`, and the dev-bundle check does not model it"]);
  });

  it("refuses `nodejs_compat` stated by an environment, naming the environment", async () => {
    const config = project({
      "wrangler.jsonc": '{ "name": "app", "main": "src/worker.ts", "env": { "staging": { "compatibility_flags": ["nodejs_compat"] } } }\n',
    });
    const result = await checkDevBundle({ ...config, bundler: async () => metafile({}) });

    expect(messages(result)).toEqual(["`env.staging.compatibility_flags` carries `nodejs_compat`, and the dev-bundle check does not model it"]);
  });

  it("refuses `define` stated by an environment, naming the environment", async () => {
    const config = project({ "wrangler.jsonc": '{ "name": "app", "main": "src/worker.ts", "env": { "staging": { "define": { "X": "1" } } } }\n' });
    const result = await checkDevBundle({ ...config, bundler: async () => metafile({}) });

    expect(messages(result)).toEqual(["`env.staging.define` is set, and the dev-bundle check does not model it"]);
  });

  it("passes the `no_nodejs_compat` flags, which leave bare built-ins unresolved as the check models them", async () => {
    const config = project({
      "wrangler.jsonc": '{ "name": "app", "main": "src/worker.ts", "compatibility_flags": ["no_nodejs_compat", "no_nodejs_compat_v2"] }\n',
    });
    const result = await checkDevBundle({ ...config, bundler: async () => metafile({ "src/worker.ts": 40 }) });

    expect(result.ok).toBe(true);
  });

  it("fails an unstated `main`", async () => {
    const config = project({ "wrangler.jsonc": '{ "name": "app" }\n' });

    expect(messages(await checkDevBundle({ ...config, bundler: async () => metafile({}) }))).toEqual([
      "`main` is unstated, so there is no deployed bundle to judge",
    ]);
  });

  it("fails loudly when a named dependency declares no forbidden list", async () => {
    const config = project({});
    installForge(config.root, { name: "@y-core/forge" });
    const result = await checkDevBundle({ ...config, bundler: async () => metafile({}) });

    expect(messages(result)).toEqual(["`@y-core/forge` declares no `forge.devOnly` subpaths"]);
  });

  it("fails a dev-only subpath published from the package's source root, which would forbid everything", async () => {
    const config = project({});
    installForge(config.root, { name: "@y-core/forge", exports: { "./dev": { import: "./src/dev.ts" } }, forge: { devOnly: ["./dev"] } });
    const result = await checkDevBundle({ ...config, bundler: async () => metafile({}) });

    expect(messages(result)).toEqual(["`@y-core/forge` publishes the dev-only `./dev` from its source root"]);
  });

  it("reports an entry that does not bundle, instead of passing it", async () => {
    const config = project({});
    const result = await checkDevBundle({
      ...config,
      bundler: async () => {
        throw new Error('Could not resolve "missing"\nsecond line');
      },
    });

    expect(messages(result)).toEqual(['`src/worker.ts` did not bundle: Could not resolve "missing"']);
  });
});

describe("checkDevBundle — the negative fixture, bundled for real", () => {
  const ENTRY = "src/worker.ts";
  const BANNER_MODULES = ["src/debug-banner.dev.ts", "src/debug-banner.strict.ts"];

  function consumer(): string {
    const root = mkdtempSync(join(tmpdir(), "forge-dev-bundle-fixture-"));
    roots.push(root);
    cpSync(resolve(import.meta.dir, "../../../../tests/fixtures/dev-bundle-consumer"), root, { recursive: true });
    installForge(root);
    return root;
  }

  const contributing = (bundled: BundleMetafile): string[] =>
    Object.values(bundled.outputs).flatMap((output) =>
      Object.entries(output.inputs)
        .filter(([, { bytesInOutput }]) => bytesInOutput > 0)
        .map(([input]) => input),
    );

  it("reports the development modules the production entry reaches, and neither the tree-shaken one nor the app's own aliased dev module", async () => {
    const result = await checkDevBundle({ root: consumer(), packages: ["@y-core/forge"] });

    expect(messages(result).toSorted()).toEqual([
      "development code in the deployed bundle — `src/grant.dev.ts`",
      "development code in the deployed bundle — `src/reveal.dev.ts`",
    ]);
  });

  it("resolves the app's own `#app/debug-banner` alias to its strict stub under wrangler's conditions", async () => {
    const inputs = contributing(await bundleWorker(consumer(), ENTRY));

    expect(BANNER_MODULES.filter((module) => inputs.includes(module))).toEqual(["src/debug-banner.strict.ts"]);
  });

  it("resolves the app's own `#app/debug-banner` alias to its development module under `forge-dev`", async () => {
    const inputs = contributing(await bundleWorker(consumer(), ENTRY, [...WRANGLER_CONDITIONS, DEV_CONDITION]));

    expect(BANNER_MODULES.filter((module) => inputs.includes(module))).toEqual(["src/debug-banner.dev.ts"]);
  });

  async function runConsumer(conditions: readonly string[], define: Record<string, string>): Promise<unknown> {
    const root = consumer();
    const { build } = await import("esbuild");
    const result = await build({ ...workerBuildOptions(root, ENTRY, conditions), define });
    const file = join(root, "worker.mjs");
    writeFileSync(file, result.outputFiles[0]?.text ?? "");
    const worker = (await import(file)) as { default: { fetch: () => Response } };
    return await worker.default.fetch().json();
  }

  const cases: { name: string; conditions: readonly string[]; define: Record<string, string>; banner: string | null }[] = [
    {
      name: "the `forge-dev` bundle when the build defines `__FORGE_DEV__` as `true`",
      conditions: [...WRANGLER_CONDITIONS, DEV_CONDITION],
      define: { __FORGE_DEV__: "true" },
      banner: "development build",
    },
    {
      name: "the `forge-dev` bundle when the build defines no `__FORGE_DEV__`",
      conditions: [...WRANGLER_CONDITIONS, DEV_CONDITION],
      define: {},
      banner: null,
    },
    {
      name: "the `forge-dev` bundle when the build defines `__FORGE_DEV__` as `false`",
      conditions: [...WRANGLER_CONDITIONS, DEV_CONDITION],
      define: { __FORGE_DEV__: "false" },
      banner: null,
    },
    {
      name: "the default bundle even when the build defines `__FORGE_DEV__` as `true`",
      conditions: WRANGLER_CONDITIONS,
      define: { __FORGE_DEV__: "true" },
      banner: null,
    },
  ];

  for (const { name, conditions, define, banner } of cases) {
    it(`answers ${banner === null ? "no banner" : "the banner"} from ${name}`, async () => {
      expect(await runConsumer(conditions, define)).toEqual({ grant: "development: granted", banner });
    });
  }
});

describe("forge's own production barrels", () => {
  const FORGE_ROOT = resolve(import.meta.dir, "../../../..");
  const ENTRY = "tests/fixtures/dev-bundle-production/worker.ts";

  async function bundledInputs(conditions?: readonly string[]): Promise<string[]> {
    const bundled = await bundleWorker(FORGE_ROOT, ENTRY, conditions);
    return Object.values(bundled.outputs).flatMap((output) =>
      Object.entries(output.inputs)
        .filter(([, { bytesInOutput }]) => bytesInOutput > 0)
        .map(([input]) => input),
    );
  }

  it("bundle no `*.dev.ts` module", async () => {
    const inputs = await bundledInputs();

    const guards = ["src/security/cop.ts", "src/security/origin.ts", "src/security/rate-limit.ts"];
    expect(guards.filter((guard) => inputs.includes(guard))).toEqual(guards);
    expect(inputs.filter((input) => /\.dev\.tsx?$/.test(input))).toEqual([]);
  });

  it("bundle every hook's development module, and the arming check, under `forge-dev`", async () => {
    const inputs = await bundledInputs([...WRANGLER_CONDITIONS, "forge-dev"]);

    expect(inputs.filter((input) => /\.dev\.tsx?$/.test(input)).toSorted()).toEqual([
      "src/app/error-page.dev.ts",
      "src/context/armed.dev.ts",
      "src/form/turnstile.dev.ts",
      "src/security/cop.dev.ts",
      "src/security/rate-limit.dev.ts",
      "src/security/url.dev.ts",
    ]);
  });
});

describe("checkDevBundle — an ambient `forge-dev` condition", () => {
  const clean = async (): Promise<BundleMetafile> => metafile({ "src/worker.ts": 40, "node_modules/@y-core/forge/src/app/mod.ts": 30 });

  for (const conditions of ["forge-dev", "workerd,worker,browser,forge-dev", " workerd , forge-dev "]) {
    it(`fails a shell whose \`WRANGLER_BUILD_CONDITIONS\` is \`${conditions}\`, naming the variable`, async () => {
      const config = project({ "src/worker.ts": "export default {};\n" });
      const result = await checkDevBundle({ ...config, bundler: clean, env: { WRANGLER_BUILD_CONDITIONS: conditions } });

      expect({ ok: result.ok, messages: messages(result) }).toEqual({
        ok: false,
        messages: ["`WRANGLER_BUILD_CONDITIONS` carries `forge-dev`, so a deploy from this shell bundles every development module"],
      });
    });
  }

  const passing: { name: string; env: Record<string, string | undefined> }[] = [
    { name: "no `WRANGLER_BUILD_CONDITIONS`", env: {} },
    { name: "wrangler's own conditions", env: { WRANGLER_BUILD_CONDITIONS: "workerd,worker,browser" } },
    { name: "a condition that only begins with `forge-dev`", env: { WRANGLER_BUILD_CONDITIONS: "workerd,forge-devtools" } },
  ];

  for (const { name, env } of passing) {
    it(`passes a shell with ${name}, as before`, async () => {
      const config = project({ "src/worker.ts": "export default {};\n" });
      const result = await checkDevBundle({ ...config, bundler: clean, env });

      expect({ ok: result.ok, summary: result.summary }).toEqual({
        ok: true,
        summary: "src/worker.ts bundles 2 modules, none of them development code",
      });
    });
  }
});

describe("the `#relax` imports map, bundled for real", () => {
  const FORGE_ROOT = resolve(import.meta.dir, "../../../..");
  const ENTRY = "tests/fixtures/dev-relax/worker.ts";
  const DEV_CONDITIONS = [...WRANGLER_CONDITIONS, "forge-dev"];

  const contributing = (bundled: BundleMetafile): string[] =>
    Object.values(bundled.outputs).flatMap((output) =>
      Object.entries(output.inputs)
        .filter(([, { bytesInOutput }]) => bytesInOutput > 0)
        .map(([input]) => input),
    );

  const STRICT_STUBS = [
    "src/app/error-page.strict.ts",
    "src/form/turnstile.strict.ts",
    "src/security/cop.strict.ts",
    "src/security/rate-limit.strict.ts",
    "src/security/url.strict.ts",
  ];

  it("resolves every alias to its strict stub under wrangler's conditions, bundling no `*.dev.ts`", async () => {
    const inputs = contributing(await bundleWorker(FORGE_ROOT, ENTRY));

    expect({ stubs: STRICT_STUBS.filter((stub) => inputs.includes(stub)), dev: inputs.filter((input) => /\.dev\.tsx?$/.test(input)) }).toEqual({
      stubs: STRICT_STUBS,
      dev: [],
    });
  });

  it("resolves every alias to its development module under `forge-dev`, with the arming check beside them", async () => {
    const inputs = contributing(await bundleWorker(FORGE_ROOT, ENTRY, DEV_CONDITIONS));

    expect(inputs.filter((input) => /\.dev\.tsx?$/.test(input)).toSorted()).toEqual([
      "src/app/error-page.dev.ts",
      "src/context/armed.dev.ts",
      "src/form/turnstile.dev.ts",
      "src/security/cop.dev.ts",
      "src/security/rate-limit.dev.ts",
      "src/security/url.dev.ts",
    ]);
  });

  async function runBundle(conditions: readonly string[], define: Record<string, string>): Promise<unknown> {
    const { build } = await import("esbuild");
    const result = await build({ ...workerBuildOptions(FORGE_ROOT, ENTRY, conditions), define });
    const dir = mkdtempSync(join(tmpdir(), "forge-dev-relax-"));
    roots.push(dir);
    const file = join(dir, "worker.mjs");
    writeFileSync(file, result.outputFiles[0]?.text ?? "");
    const worker = (await import(file)) as { default: { fetch: (request: Request, env: object) => Promise<Response> } };
    const consoleLog = spyOn(console, "log").mockImplementation(() => {});
    try {
      const response = await worker.default.fetch(new Request("https://app.example/"), {
        FORGE_DEV_ORIGINS: " https://preview.example , http://localhost:8787 ",
      });
      return await response.json();
    } finally {
      consoleLog.mockRestore();
    }
  }

  const STRICT = { absentLimiter: false, missingFetchMetadata: false, extraOrigins: [], testingSecret: false, disclosed: null };

  it("answers strict from the `forge-dev` bundle when the build defines no `__FORGE_DEV__`", async () => {
    expect(await runBundle(DEV_CONDITIONS, {})).toEqual(STRICT);
  });

  it("answers relaxed from the `forge-dev` bundle when the build defines `__FORGE_DEV__` as `true`", async () => {
    expect(await runBundle(DEV_CONDITIONS, { __FORGE_DEV__: "true" })).toEqual({
      absentLimiter: true,
      missingFetchMetadata: true,
      extraOrigins: ["https://preview.example", "http://localhost:8787"],
      testingSecret: true,
      disclosed: "refused",
    });
  });

  it("answers strict from the default bundle even when the build defines `__FORGE_DEV__` as `true`", async () => {
    expect(await runBundle(WRANGLER_CONDITIONS, { __FORGE_DEV__: "true" })).toEqual(STRICT);
  });
});

describe("each public hook, bundled through its barrel and run", () => {
  const FORGE_ROOT = resolve(import.meta.dir, "../../../..");
  const ENTRY = "tests/fixtures/dev-relax-hooks/worker.ts";
  const DEV_CONDITIONS = [...WRANGLER_CONDITIONS, "forge-dev"];
  const PREVIEW_ORIGIN = "https://preview.example";

  type Verdicts = Record<string, unknown> & { createErrorPage: string; fallback: string };

  const firstParagraph = (body: string): string => body.slice(body.indexOf("<p>"), body.indexOf("</p>") + "</p>".length);
  const fallbackDocument = (message: string): string =>
    `<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1><p>${message}</p></body></html>`;

  async function runHooks(conditions: readonly string[], define: Record<string, string>): Promise<Verdicts> {
    const { build } = await import("esbuild");
    const result = await build({ ...workerBuildOptions(FORGE_ROOT, ENTRY, conditions), define });
    const dir = mkdtempSync(join(tmpdir(), "forge-dev-relax-hooks-"));
    roots.push(dir);
    const file = join(dir, "worker.mjs");
    writeFileSync(file, result.outputFiles[0]?.text ?? "");
    const worker = (await import(file)) as { default: { fetch: (request: Request, env: object) => Promise<Response> } };
    const consoleLog = spyOn(console, "log").mockImplementation(() => {});
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const siteverify = spyOn(globalThis, "fetch").mockImplementation((async () =>
      Response.json({ success: true, hostname: "example.com" })) as unknown as typeof fetch);
    try {
      const response = await worker.default.fetch(new Request("https://app.example/"), { FORGE_DEV_ORIGINS: PREVIEW_ORIGIN, PREVIEW_ORIGIN });
      const verdicts = (await response.json()) as Verdicts;
      return { ...verdicts, createErrorPage: firstParagraph(verdicts.createErrorPage) };
    } finally {
      siteverify.mockRestore();
      consoleError.mockRestore();
      consoleLog.mockRestore();
    }
  }

  const STRICT: Verdicts = {
    rateLimit: 503,
    checkCrossOriginProtection: false,
    crossOriginProtection: 403,
    originGuard: 403,
    originProtection: 403,
    verifyTurnstile: false,
    createErrorPage: "<p>An unexpected error occurred.</p>",
    fallback: fallbackDocument("An unexpected error occurred."),
  };

  it("relaxes every hook, and both error pages disclose, from the `forge-dev` bundle when the build defines `__FORGE_DEV__` as `true`", async () => {
    expect(await runHooks(DEV_CONDITIONS, { __FORGE_DEV__: "true" })).toEqual({
      rateLimit: 200,
      checkCrossOriginProtection: true,
      crossOriginProtection: 200,
      originGuard: 200,
      originProtection: 200,
      verifyTurnstile: true,
      createErrorPage: "<p>refused</p>",
      fallback: fallbackDocument("refused"),
    });
  });

  it("keeps every hook strict, and both error pages fixed, from the `forge-dev` bundle when the build defines no `__FORGE_DEV__`", async () => {
    expect(await runHooks(DEV_CONDITIONS, {})).toEqual(STRICT);
  });

  it("keeps every hook strict, and both error pages fixed, from the default bundle even when the build defines `__FORGE_DEV__` as `true`", async () => {
    expect(await runHooks(WRANGLER_CONDITIONS, { __FORGE_DEV__: "true" })).toEqual(STRICT);
  });
});
