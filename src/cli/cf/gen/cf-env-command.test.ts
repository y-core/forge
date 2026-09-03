import { afterEach, describe, expect, it, mock } from "bun:test";
import * as childProcess from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// mock.module must be registered before cf-env-command loads, hence the dynamic imports below; it is process-global, so the real module is spread through.
const mockSpawnSync = mock((_cmd: string, _args?: string[], _opts?: unknown): { status: number | null; error?: Error } => ({ status: 0 }));
await mock.module("node:child_process", () => ({ ...childProcess, spawnSync: mockSpawnSync }));

const { createGenEnvCommand, loadOptions, readWranglerConfig } = await import("./cf-env-command");
const { execute } = await import("../../core/execute");
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

    await execute(createGenEnvCommand(), [
      "--wrangler",
      wranglerPath,
      "--dev-vars",
      devVarsPath,
      "--out",
      outPath,
      "--config",
      join(dir, "absent.ts"),
    ]);

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

    await execute(createGenEnvCommand(), [
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

    await execute(createGenEnvCommand(), ["--wrangler", wranglerPath, "--dev-vars", join(dir, "none"), "--out", outPath, "--config", configPath]);

    const generated = readFileSync(outPath, "utf-8");
    expect(generated).toContain("v.optional(");
    expect(generated).toContain("CACHE");
  });

  it("invokes oxfmt via the (mocked) spawnSync formatter", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const outPath = join(dir, "env.schema.ts");
    writeFileSync(wranglerPath, `{}`);
    mockSpawnSync.mockClear();

    await execute(createGenEnvCommand(), [
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
    expect(cmd).toBe("oxfmt");
    expect(args).toEqual([outPath]);
  });
});

describe("createGenEnv — an oxfmt that never formatted", () => {
  const origLog = console.log;
  const origError = console.error;

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
    mockSpawnSync.mockImplementation(() => ({ status: 0 }));
  });

  it("falls back to the local binary and reports the failure rather than swallowing it", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const outPath = join(dir, "env.schema.ts");
    writeFileSync(wranglerPath, `{}`);
    // A non-zero exit with no `error`: oxfmt ran and refused the file, which is not a spawn failure.
    mockSpawnSync.mockImplementation(() => ({ status: 1 }));
    mockSpawnSync.mockClear();
    const err: string[] = [];
    console.log = () => {};
    console.error = (msg: string) => err.push(msg);

    await execute(createGenEnvCommand(), [
      "--wrangler",
      wranglerPath,
      "--dev-vars",
      join(dir, "none"),
      "--out",
      outPath,
      "--config",
      join(dir, "absent.ts"),
    ]);

    expect(mockSpawnSync.mock.calls.map((call) => call[0])).toEqual(["oxfmt", join(process.cwd(), "node_modules", ".bin", "oxfmt")]);
    expect(err).toEqual([`[cf gen env] oxfmt failed; ${outPath} is unformatted`]);
    expect(readFileSync(outPath, "utf-8")).toBe(emit([]));
  });
});
