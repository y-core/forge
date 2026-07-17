import { describe, expect, it, mock } from "bun:test";
import * as childProcess from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Install the mock before cf-env-command loads so its top-level `spawnSync` import gets the
// stub — the run handler shells out to biome, which must not execute in tests. mock.module is
// process-global; spread the real module to preserve other exports for sibling test files.
const mockSpawnSync = mock((_cmd: string, _args?: string[], _opts?: unknown): { status: number | null; error?: Error } => ({ status: 0 }));
mock.module("node:child_process", () => ({ ...childProcess, spawnSync: mockSpawnSync }));

const { createGenEnv, loadOptions, readWranglerConfig } = await import("./cf-env-command");
const { execute } = await import("../../cli/execute");
const { collectBindings, collectVars, emit } = await import("./cf-env-gen");
const { DEFAULT_OPTIONS } = await import("./cf-env-registry");

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "cfgen-"));
}

describe("readWranglerConfig", () => {
  it("parses JSONC with comments and trailing commas into the exact object", () => {
    const dir = tempDir();
    const path = join(dir, "wrangler.jsonc");
    writeFileSync(
      path,
      `{
        // worker name
        "name": "demo", /* inline */
        "vars": { "BASE_URL": "https://example.com", },
        "kv_namespaces": [ { "binding": "LOGS", "id": "1" }, ],
      }`,
    );
    expect(readWranglerConfig(path)).toEqual({
      name: "demo",
      vars: { BASE_URL: "https://example.com" },
      kv_namespaces: [{ binding: "LOGS", id: "1" }],
    });
  });

  it("throws on malformed JSON after comment stripping", () => {
    const dir = tempDir();
    const path = join(dir, "wrangler.jsonc");
    writeFileSync(path, "{ not valid json ");
    expect(() => readWranglerConfig(path)).toThrow();
  });

  it("throws when the file does not exist", () => {
    expect(() => readWranglerConfig(join(tempDir(), "missing.jsonc"))).toThrow();
  });
});

describe("loadOptions — error paths", () => {
  it("rejects when the config module path does not exist", async () => {
    await expect(loadOptions(join(tempDir(), "nope.config.ts"))).rejects.toThrow();
  });

  it("returns DEFAULT_OPTIONS when no path is given", async () => {
    expect(await loadOptions()).toBe(DEFAULT_OPTIONS);
  });
});

describe("createGenEnv — run handler end-to-end", () => {
  it("generates the schema module from wrangler.jsonc + .dev.vars (exact emit output)", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const devVarsPath = join(dir, ".dev.vars");
    const outPath = join(dir, "env.schema.ts");
    writeFileSync(
      wranglerPath,
      `{
        "vars": { "BASE_URL": "https://example.com" },
        "kv_namespaces": [{ "binding": "LOGS" }], // one KV binding
      }`,
    );
    writeFileSync(devVarsPath, "CSRF_SECRET=deadbeef\n");

    // Absolute flag paths make the handler cwd-independent (resolve() passes them through).
    await execute(createGenEnv(), ["--wrangler", wranglerPath, "--dev-vars", devVarsPath, "--out", outPath, "--config", join(dir, "absent.ts")]);

    const cfg = readWranglerConfig(wranglerPath);
    const expected = emit([
      ...collectBindings(cfg, DEFAULT_OPTIONS),
      ...collectVars("CSRF_SECRET=deadbeef\n", cfg.vars as Record<string, unknown>, DEFAULT_OPTIONS),
    ]);
    expect(readFileSync(outPath, "utf-8")).toBe(expected);
  });

  it("falls back to an empty .dev.vars when the file is absent", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const outPath = join(dir, "env.schema.ts");
    writeFileSync(wranglerPath, `{ "vars": { "BASE_URL": "https://example.com" } }`);

    await execute(createGenEnv(), [
      "--wrangler",
      wranglerPath,
      "--dev-vars",
      join(dir, "no-such.dev.vars"),
      "--out",
      outPath,
      "--config",
      join(dir, "absent.ts"),
    ]);

    const cfg = readWranglerConfig(wranglerPath);
    const expected = emit(collectVars("", cfg.vars as Record<string, unknown>, DEFAULT_OPTIONS));
    expect(readFileSync(outPath, "utf-8")).toBe(expected);
  });

  it("applies a host-policy config module over the defaults", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const configPath = join(dir, "env.config.ts");
    const outPath = join(dir, "env.schema.ts");
    writeFileSync(wranglerPath, `{ "kv_namespaces": [{ "binding": "CACHE" }] }`);
    writeFileSync(configPath, `export const options = { optional: new Set(["CACHE"]) };`);

    await execute(createGenEnv(), ["--wrangler", wranglerPath, "--dev-vars", join(dir, "none"), "--out", outPath, "--config", configPath]);

    const generated = readFileSync(outPath, "utf-8");
    expect(generated).toContain("v.optional(");
    expect(generated).toContain("CACHE");
  });

  it("invokes biome via the (mocked) spawnSync formatter", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const outPath = join(dir, "env.schema.ts");
    writeFileSync(wranglerPath, `{}`);
    mockSpawnSync.mockClear();

    await execute(createGenEnv(), [
      "--wrangler",
      wranglerPath,
      "--dev-vars",
      join(dir, "none"),
      "--out",
      outPath,
      "--config",
      join(dir, "absent.ts"),
    ]);

    expect(mockSpawnSync).toHaveBeenCalled();
    const [cmd, args] = mockSpawnSync.mock.calls[0] as [string, string[]];
    expect(cmd).toBe("biome");
    expect(args).toEqual(["check", "--write", outPath]);
  });
});
