import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execute } from "../../cli/execute";
import type { SpawnOptions, SpawnOutcome } from "../../cli/types";
import { parseWranglerConfig } from "../config/parse";
import { createGenEnvCommand, defaultEnvFlags, defineEnvConfig, loadOptions, regenerateCommand, renderEnvSchema } from "./cf-env-command";
import { collectBindings, collectSecretNames, collectVars, emit } from "./cf-env-gen";
import { DEFAULT_OPTIONS } from "./cf-env-registry";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// The injected seam, not `mock.module`: a module mock is process-global and Bun never restores it,
// so it reaches whatever loads `node:child_process` after this file and decides by load order.
const echoInput = (_cmd: string, _args: string[], opts: SpawnOptions): SpawnOutcome => ({ status: 0, stdout: opts.input });
const mockSpawnSync = mock(echoInput);

function defaultFlags(): Record<"wrangler" | "dev-vars" | "out" | "config", string> {
  const { flags } = createGenEnvCommand();
  const of = (name: string): string => {
    const flag = flags[name];
    return flag?.type === "string" && flag.default !== undefined ? flag.default : "";
  };
  return { wrangler: of("wrangler"), "dev-vars": of("dev-vars"), out: of("out"), config: of("config") };
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cfgen-"));
  roots.push(dir);
  return dir;
}

describe("loadOptions — error paths", () => {
  it("rejects when the config module path does not exist", async () => {
    await expect(loadOptions(tempDir(), join(tempDir(), "nope.config.ts"))).rejects.toThrow();
  });

  it("returns DEFAULT_OPTIONS when no path is given", async () => {
    expect(await loadOptions(tempDir())).toBe(DEFAULT_OPTIONS);
  });

  it("refuses a module that carries its options only as a named export", async () => {
    const configPath = join(tempDir(), "env.config.ts");
    writeFileSync(configPath, `export const options = { optional: new Set(["CACHE"]) };`);

    await expect(loadOptions(tempDir(), configPath)).rejects.toThrow("has no default export");
  });
});

describe("defineEnvConfig()", () => {
  it("returns its argument unchanged", () => {
    const config = { optional: new Set(["CACHE"]) };

    expect(defineEnvConfig(config)).toBe(config);
  });
});

describe("regenerateCommand", () => {
  it("is the bare command when every flag holds its default", () => {
    expect(regenerateCommand(defaultFlags())).toBe("forge cf gen env");
  });

  it("names an --out that differs from the default", () => {
    expect(regenerateCommand({ ...defaultFlags(), out: "src/app/env-schema.ts" })).toBe("forge cf gen env --out src/app/env-schema.ts");
  });

  it("quotes a value a shell would split or reinterpret, so the command gives back the same arguments", () => {
    const out = "src/my app/it's env.ts";
    const command = regenerateCommand({ ...defaultFlags(), out });
    const rest = command.slice("forge cf gen env ".length);
    const argv = (spawnSync("sh", ["-c", `printf '%s\\0' ${rest}`], { encoding: "utf-8" }).stdout ?? "").split("\0").slice(0, -1);
    expect(argv).toEqual(["--out", out]);
  });

  it("leaves a plain path unquoted", () => {
    expect(regenerateCommand({ ...defaultFlags(), out: "src/app/env-schema.ts" })).not.toContain("'");
  });

  it("names every non-default flag in declaration order, whatever order the record holds them in", () => {
    const flags = { config: "config/prod.env.ts", out: "src/app/env-schema.ts", "dev-vars": ".dev.vars", wrangler: "wrangler.prod.jsonc" };
    expect(regenerateCommand(flags)).toBe(
      "forge cf gen env --wrangler wrangler.prod.jsonc --out src/app/env-schema.ts --config config/prod.env.ts",
    );
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
        "name": "app",
        "vars": { "BASE_URL": "https://example.com" },
        "kv_namespaces": [{ "binding": "LOGS" }], // one KV binding
      }`,
    );
    writeFileSync(devVarsPath, "CSRF_SECRET=deadbeef\n");

    await execute(createGenEnvCommand(mockSpawnSync), [
      "--wrangler",
      wranglerPath,
      "--dev-vars",
      devVarsPath,
      "--out",
      outPath,
      "--config",
      join(dir, "absent.ts"),
    ]);

    const cfg = parseWranglerConfig(wranglerPath);
    const expected = emit(
      [
        ...collectBindings(cfg, DEFAULT_OPTIONS),
        ...collectVars(collectSecretNames(cfg, "CSRF_SECRET=deadbeef\n"), cfg.vars ?? {}, DEFAULT_OPTIONS),
      ],
      `forge cf gen env --wrangler ${wranglerPath} --dev-vars ${devVarsPath} --out ${outPath} --config ${join(dir, "absent.ts")}`,
    );
    expect(readFileSync(outPath, "utf-8")).toBe(expected);
  });

  it("falls back to an empty .dev.vars when the file is absent", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const outPath = join(dir, "env.schema.ts");
    writeFileSync(wranglerPath, `{ "name": "app", "vars": { "BASE_URL": "https://example.com" } }`);

    await execute(createGenEnvCommand(mockSpawnSync), [
      "--wrangler",
      wranglerPath,
      "--dev-vars",
      join(dir, "no-such.dev.vars"),
      "--out",
      outPath,
      "--config",
      join(dir, "absent.ts"),
    ]);

    const cfg = parseWranglerConfig(wranglerPath);
    const expected = emit(
      collectVars(collectSecretNames(cfg, ""), cfg.vars ?? {}, DEFAULT_OPTIONS),
      `forge cf gen env --wrangler ${wranglerPath} --dev-vars ${join(dir, "no-such.dev.vars")} --out ${outPath} --config ${join(dir, "absent.ts")}`,
    );
    expect(readFileSync(outPath, "utf-8")).toBe(expected);
  });

  it("takes secret names from `secrets.required` and stops reading .dev.vars for them", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const devVarsPath = join(dir, ".dev.vars");
    const outPath = join(dir, "env.schema.ts");
    writeFileSync(wranglerPath, `{ "name": "app", "secrets": { "required": ["API_KEY"] } }`);
    writeFileSync(devVarsPath, "CSRF_SECRET=x\n");

    await execute(createGenEnvCommand(mockSpawnSync), [
      "--wrangler",
      wranglerPath,
      "--dev-vars",
      devVarsPath,
      "--out",
      outPath,
      "--config",
      join(dir, "absent.ts"),
    ]);

    const generated = readFileSync(outPath, "utf-8");
    expect([generated.includes("API_KEY: v.string()"), generated.includes("CSRF_SECRET")]).toEqual([true, false]);
  });

  it("applies a host-policy config module over the defaults", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const configPath = join(dir, "env.config.ts");
    const outPath = join(dir, "env.schema.ts");
    writeFileSync(wranglerPath, `{ "name": "app", "kv_namespaces": [{ "binding": "CACHE" }] }`);
    writeFileSync(configPath, `export default { optional: new Set(["CACHE"]) };`);

    await execute(createGenEnvCommand(mockSpawnSync), [
      "--wrangler",
      wranglerPath,
      "--dev-vars",
      join(dir, "none"),
      "--out",
      outPath,
      "--config",
      configPath,
    ]);

    const generated = readFileSync(outPath, "utf-8");
    expect(generated).toContain("v.optional(");
    expect(generated).toContain("CACHE");
  });

  it("writes a module whose first line names the --out it was run with", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const outPath = join(dir, "env-schema.ts");
    writeFileSync(wranglerPath, `{ "name": "app" }`);
    const argv = ["--wrangler", wranglerPath, "--dev-vars", join(dir, "none"), "--out", outPath, "--config", join(dir, "absent.ts")];

    await execute(createGenEnvCommand(mockSpawnSync), argv);

    expect(readFileSync(outPath, "utf-8").split("\n")[0]).toBe(`/** GENERATED — do not edit; run \`forge cf gen env ${argv.join(" ")}\`. */`);
  });

  it("follows the top-level entries with named-env-only vars, then policy-only optional vars", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const configPath = join(dir, "env.config.ts");
    const outPath = join(dir, "env.schema.ts");
    writeFileSync(
      wranglerPath,
      `{
        "name": "app",
        "vars": { "LOG_LEVEL": "info" },
        "env": { "dev": { "vars": { "LOG_LEVEL": "debug", "SITE_ORIGIN": "http://localhost" } } },
      }`,
    );
    writeFileSync(configPath, `export default { optional: new Set(["SITE_ORIGIN", "TURNSTILE_SITE_KEY"]) };`);

    await execute(createGenEnvCommand(mockSpawnSync), [
      "--wrangler",
      wranglerPath,
      "--dev-vars",
      join(dir, "none"),
      "--out",
      outPath,
      "--config",
      configPath,
    ]);

    expect(readFileSync(outPath, "utf-8")).toBe(
      emit(
        [
          { name: "LOG_LEVEL", expr: "v.string()" },
          { name: "SITE_ORIGIN", expr: "v.optional(v.string())" },
          { name: "TURNSTILE_SITE_KEY", expr: "v.optional(v.string())" },
        ],
        `forge cf gen env --wrangler ${wranglerPath} --dev-vars ${join(dir, "none")} --out ${outPath} --config ${configPath}`,
      ),
    );
  });

  it("invokes bun fmt through the spawner it was given", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const outPath = join(dir, "env.schema.ts");
    writeFileSync(wranglerPath, `{ "name": "app" }`);
    mockSpawnSync.mockClear();

    await execute(createGenEnvCommand(mockSpawnSync), [
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
    const [cmd, args] = mockSpawnSync.mock.calls[0]!;
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual(["fmt", "--no-script", "--stdin-filepath", outPath]);
  });
});

describe("createGenEnv — a worker config it cannot load", () => {
  it("refuses a config that names no Worker, exiting 1 and writing no schema", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const outPath = join(dir, "env.schema.ts");
    writeFileSync(wranglerPath, `{ "vars": { "BASE_URL": "https://example.com" } }`);
    const err: string[] = [];
    const exits: number[] = [];

    await execute(
      createGenEnvCommand(mockSpawnSync),
      ["--wrangler", wranglerPath, "--dev-vars", join(dir, "none"), "--out", outPath, "--config", join(dir, "absent.ts")],
      { stdout: () => {}, stderr: (msg) => err.push(msg), exit: ((code: number) => exits.push(code)) as (code: number) => never },
    );

    expect([exits, err.length, existsSync(outPath)]).toEqual([[1], 1, false]);
    expect(err[0]?.startsWith(`Error: malformed wrangler config at ${wranglerPath}: name:`)).toBe(true);
  });
});

describe("createGenEnv — a bun fmt that never formatted", () => {
  const origLog = console.log;
  const origError = console.error;

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
    mockSpawnSync.mockImplementation(echoInput);
  });

  it("reports the failure rather than swallowing it", async () => {
    const dir = tempDir();
    const wranglerPath = join(dir, "wrangler.jsonc");
    const outPath = join(dir, "env.schema.ts");
    writeFileSync(wranglerPath, `{ "name": "app" }`);
    mockSpawnSync.mockImplementation(() => ({ status: 1 }));
    mockSpawnSync.mockClear();
    const err: string[] = [];
    console.log = () => {};
    console.error = (msg: string) => err.push(msg);

    await execute(createGenEnvCommand(mockSpawnSync), [
      "--wrangler",
      wranglerPath,
      "--dev-vars",
      join(dir, "none"),
      "--out",
      outPath,
      "--config",
      join(dir, "absent.ts"),
    ]);

    expect(mockSpawnSync.mock.calls.map((call) => call[0])).toEqual([process.execPath]);
    expect(err).toEqual([`[cf gen env] bun fmt failed; ${outPath} is unformatted`]);
    expect(readFileSync(outPath, "utf-8")).toBe(
      emit([], `forge cf gen env --wrangler ${wranglerPath} --dev-vars ${join(dir, "none")} --out ${outPath} --config ${join(dir, "absent.ts")}`),
    );
  });
});

describe("defaultEnvFlags()", () => {
  it("holds the flag defaults a bare `forge cf gen env` runs with", () => {
    expect(defaultEnvFlags()).toEqual(defaultFlags());
  });
});

describe("renderEnvSchema()", () => {
  const WRANGLER = `{ "name": "app", "vars": { "BASE_URL": "https://example.com" }, "secrets": { "required": ["API_KEY"] } }`;

  function fixtureFlags(dir: string): Record<"wrangler" | "dev-vars" | "out" | "config", string> {
    writeFileSync(join(dir, "wrangler.jsonc"), WRANGLER);
    return {
      wrangler: join(dir, "wrangler.jsonc"),
      "dev-vars": join(dir, ".dev.vars"),
      out: join(dir, "env.schema.ts"),
      config: join(dir, "absent.ts"),
    };
  }

  it("renders exactly what the command writes for the same root and flags", async () => {
    const dir = tempDir();
    const flags = fixtureFlags(dir);
    await execute(
      createGenEnvCommand(),
      Object.entries(flags).flatMap(([name, value]) => [`--${name}`, value]),
    );

    expect((await renderEnvSchema(dir, flags)).text).toBe(readFileSync(flags.out, "utf-8"));
  });

  it("formats under the root's own formatter config", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".oxfmtrc.json"), `{ "singleQuote": true }`);
    const rendered = await renderEnvSchema(dir, fixtureFlags(dir));

    expect([rendered.formatted, rendered.text.split("\n")[2]]).toEqual([true, "import { v } from '@y-core/forge/validation';"]);
  });

  it("reports the entries it rendered, vars before secrets", async () => {
    const dir = tempDir();

    expect((await renderEnvSchema(dir, fixtureFlags(dir), mockSpawnSync)).entries).toEqual([
      { name: "BASE_URL", expr: "v.string()" },
      { name: "API_KEY", expr: "v.string()" },
    ]);
  });

  it("reports whether a host-policy module was found at --config", async () => {
    const dir = tempDir();
    const flags = fixtureFlags(dir);
    const absent = (await renderEnvSchema(dir, flags, mockSpawnSync)).configured;
    writeFileSync(flags.config, `export default {};\n`);
    const present = (await renderEnvSchema(dir, flags, mockSpawnSync)).configured;

    expect([absent, present]).toEqual([false, true]);
  });

  it("hands bun fmt the raw module on stdin, from the root, under the --out path", async () => {
    const dir = tempDir();
    const flags = fixtureFlags(dir);
    mockSpawnSync.mockClear();
    await renderEnvSchema(dir, flags, mockSpawnSync);
    const [cmd, args, opts] = mockSpawnSync.mock.calls[0]!;

    expect([cmd, args, opts.cwd, opts.input]).toEqual([
      process.execPath,
      ["fmt", "--no-script", "--stdin-filepath", flags.out],
      dir,
      emit(
        [
          { name: "BASE_URL", expr: "v.string()" },
          { name: "API_KEY", expr: "v.string()" },
        ],
        regenerateCommand(flags),
      ),
    ]);
  });

  const failures: { name: string; outcome: SpawnOutcome }[] = [
    { name: "exits non-zero", outcome: { status: 1, stdout: "partial" } },
    { name: "exits 0 with a spawn error", outcome: { status: 0, stdout: "partial", error: new Error("spawnSync bun ENOBUFS") } },
  ];
  for (const { name, outcome } of failures) {
    it(`falls back to the raw emit text, unformatted, when bun fmt ${name}`, async () => {
      const dir = tempDir();
      const flags = fixtureFlags(dir);
      const rendered = await renderEnvSchema(dir, flags, () => outcome);

      expect([rendered.formatted, rendered.text]).toEqual([
        false,
        emit(
          [
            { name: "BASE_URL", expr: "v.string()" },
            { name: "API_KEY", expr: "v.string()" },
          ],
          `forge cf gen env --wrangler ${flags.wrangler} --dev-vars ${flags["dev-vars"]} --out ${flags.out} --config ${flags.config}`,
        ),
      ]);
    });
  }
});
