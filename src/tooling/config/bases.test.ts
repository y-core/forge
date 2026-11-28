import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { stripJsonc } from "../cli/jsonc";
import { OXLINT_BASE, TSCONFIG_BASE } from "../gate/checks/config-files";

const ROOT = resolve(import.meta.dir, "../../..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { name: string; exports: Record<string, unknown> };
const read = (file: string) => JSON.parse(stripJsonc(readFileSync(join(import.meta.dir, file), "utf-8")));

describe("the exported config bases", () => {
  // Both by path: oxlint never consults `exports`, and Bun's runtime transpiler ignores a package `extends`.
  it("are reached by the node_modules paths validate-config-files demands", () => {
    for (const base of [OXLINT_BASE, TSCONFIG_BASE]) {
      expect(base.startsWith(`./node_modules/${pkg.name}/`)).toBe(true);
      expect(existsSync(join(ROOT, base.replace(`./node_modules/${pkg.name}/`, "")))).toBe(true);
    }
  });

  it("export all three through the package's exports map", () => {
    for (const base of ["oxlint.base.json", "oxfmt.base.json", "tsconfig.app.json"]) {
      expect(Object.values(pkg.exports)).toContain(`./src/tooling/config/${base}`);
    }
  });

  // oxlint resolves `jsPlugins` against the base file, and node will not strip types under `node_modules`.
  it("name the lint plugin as the committed bundle beside the base", () => {
    const { jsPlugins } = read("oxlint.base.json") as { jsPlugins: string[] };
    expect(jsPlugins).toEqual(["../lint/plugin.node.mjs"]);
    expect(existsSync(resolve(import.meta.dir, "../lint/plugin.node.mjs"))).toBe(true);
  });

  // oxlint does not inherit `ignorePatterns` through `extends`, so one here would be inert.
  it("leave the lint ignore list to each repository", () => {
    expect(read("oxlint.base.json")).not.toHaveProperty("ignorePatterns");
  });

  it("carry every compiler flag CONFIG_BASELINE §1 requires beyond strict", () => {
    const { compilerOptions } = read("tsconfig.app.json") as { compilerOptions: Record<string, unknown> };
    expect(compilerOptions).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
      allowUnreachableCode: false,
      erasableSyntaxOnly: true,
    });
  });

  // `paths` resolves against the file that declares it, which for a base is inside `node_modules`.
  it("leave `paths` and `include` to the repository", () => {
    const tsconfig = read("tsconfig.app.json") as { compilerOptions: Record<string, unknown> };
    expect(tsconfig).not.toHaveProperty("include");
    expect(tsconfig.compilerOptions).not.toHaveProperty("paths");
  });
});

describe("the shipped lint base's Worker-globals ban", () => {
  const app = mkdtempSync(join(tmpdir(), "forge-oxlint-base-"));
  afterAll(() => rmSync(app, { recursive: true, force: true }));
  mkdirSync(join(app, "node_modules/@y-core"), { recursive: true });
  symlinkSync(ROOT, join(app, `node_modules/${pkg.name}`));
  const files: Record<string, string> = {
    ".oxlintrc.json": JSON.stringify({ extends: [OXLINT_BASE] }),
    "src/worker.ts": 'export const mode = process.env["MODE"];\n',
    "src/node.ts": 'import process from "node:process";\n\nexport const mode = process.env["MODE"];\n',
    "config/build.ts": 'export const mode = process.env["MODE"];\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(app, path, ".."), { recursive: true });
    writeFileSync(join(app, path), text);
  }

  // The base's override globs resolve against the app that extends it, not against `node_modules`.
  it("refuses a global `process` and an imported `node:process` in Worker source, and leaves `config/` alone", () => {
    const run = spawnSync(join(ROOT, "node_modules/.bin/oxlint"), ["--format", "unix", "-c", ".oxlintrc.json", "src", "config"], {
      cwd: app,
      encoding: "utf8",
    });
    const flaggedBy = (rule: string) =>
      run.stdout
        .split("\n")
        .filter((line) => line.includes(`eslint(${rule})`))
        .map((line) => line.slice(0, line.indexOf(":")));
    expect(flaggedBy("no-restricted-globals")).toEqual(["src/worker.ts"]);
    expect(flaggedBy("no-restricted-imports")).toEqual(["src/node.ts"]);
    expect(run.status).toBe(1);
  });
});

describe("the shipped lint base's Worker-globals ban, by global and by file", () => {
  const app = mkdtempSync(join(tmpdir(), "forge-oxlint-globals-"));
  afterAll(() => rmSync(app, { recursive: true, force: true }));
  mkdirSync(join(app, "node_modules/@y-core"), { recursive: true });
  symlinkSync(ROOT, join(app, `node_modules/${pkg.name}`));
  const files: Record<string, string> = {
    ".oxlintrc.json": JSON.stringify({ extends: [OXLINT_BASE] }),
    "src/bun.ts": 'export const mode = Bun.env["MODE"];\n',
    "src/buffer.ts": 'export const encoded = Buffer.from("a").toString("base64");\n',
    "src/global-object.ts": 'export const mode = globalThis.process.env["MODE"];\n',
    "src/env.test.ts": 'export const mode = process.env["MODE"];\n',
    "src/file.test.ts": 'export const read = Bun.file("a.txt");\n',
    "src/imported.test.ts": 'import { file } from "bun";\n\nexport const read = file("a.txt");\n',
    "src/node.test.ts": 'import process from "node:process";\n\nexport const mode = process.env["MODE"];\n',
    "tests/node.workerd.ts": 'import { Buffer } from "node:buffer";\n\nexport const encoded = Buffer.from("a").toString("base64");\n',
    "tests/page.workerd.ts": 'export const mode = process.env["MODE"];\n',
    "scripts/release.ts": 'export const read = Bun.file("a.txt");\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(app, path, ".."), { recursive: true });
    writeFileSync(join(app, path), text);
  }

  it("refuses `Bun`, `Buffer` and `globalThis.process` in Worker source, only `Bun` in a spec, and none in tests/ or scripts/, where a node import passes too", () => {
    const run = spawnSync(join(ROOT, "node_modules/.bin/oxlint"), ["--format", "unix", "-c", ".oxlintrc.json", "src", "tests", "scripts"], {
      cwd: app,
      encoding: "utf8",
    });
    const flagged = run.stdout
      .split("\n")
      .filter((line) => line.includes("eslint(no-restricted-globals)"))
      .map((line) => line.slice(0, line.indexOf(":")))
      .sort();
    expect(flagged).toEqual(["src/buffer.ts", "src/bun.ts", "src/file.test.ts", "src/global-object.ts"]);
    expect(run.stdout).not.toContain("eslint(no-restricted-imports)");
  });
});

describe("forge's own Worker-source ban", () => {
  type Ban = { name: string };
  type Rules = { "eslint/no-restricted-globals": [string, { globals: Ban[] }]; "eslint/no-restricted-imports": [string, { paths: Ban[] }] };
  const names = (rules: Rules) => ({
    globals: rules["eslint/no-restricted-globals"][1].globals.map((ban) => ban.name),
    imports: rules["eslint/no-restricted-imports"][1].paths.map((ban) => ban.name),
  });

  const base = read("oxlint.base.json") as { rules: Rules };
  const own = JSON.parse(stripJsonc(readFileSync(join(ROOT, ".oxlintrc.json"), "utf-8"))) as {
    overrides: { files: string[]; rules: Partial<Rules> }[];
  };

  it("names the globals and node modules the shipped base does, in its `src/**` override", () => {
    const worker = own.overrides.find((override) => override.files.length === 1 && override.files[0] === "src/**");
    expect(worker).toBeDefined();
    expect(names((worker?.rules ?? base.rules) as Rules)).toEqual(names(base.rules));
    expect(names(base.rules).imports).toEqual(["node:process", "process", "node:buffer", "buffer"]);
  });

  // oxlint replaces a rule's options wholesale per override, so every Worker-source override that sets the rule restates the ban.
  const liftsBan = (files: string[]) => files.includes("src/tooling/**");
  const restating = own.overrides.filter(
    (override) =>
      override.rules["eslint/no-restricted-imports"] !== undefined &&
      override.files.every((glob) => glob.startsWith("src/")) &&
      !liftsBan(override.files),
  );

  it("restates the ban in at least the four Worker-source overrides known to set the rule", () => {
    expect(restating.length).toBeGreaterThanOrEqual(4);
  });

  it.each(restating.map((override) => [override.files.join(", "), override] as const))(
    "names the node modules the shipped base does, in its `%s` override",
    (_files, override) => {
      const imports = override.rules["eslint/no-restricted-imports"]?.[1].paths?.map((ban) => ban.name);
      expect(imports).toEqual(names(base.rules).imports);
    },
  );
});

describe("the shipped lint base's layer rules, over the workers-consumer app", () => {
  const app = join(ROOT, "tests/fixtures/workers-consumer/app");

  it("refuses the planted controller→controller import and nothing else in the app", () => {
    const run = spawnSync(join(ROOT, "node_modules/.bin/oxlint"), ["--format", "json", "-c", ".oxlintrc.json", "src"], {
      cwd: app,
      encoding: "utf-8",
    });
    const { diagnostics } = JSON.parse(run.stdout) as { diagnostics: { filename: string; help?: string; labels: { span: { line: number } }[] }[] };

    expect(diagnostics.map(({ filename, labels, help }) => [filename, labels[0]?.span.line, help?.split(" ")[0]])).toEqual([
      ["src/controllers/home.ts", 2, "[app-architecture-controller-imports-controller]"],
    ]);
  });

  // Each layer override replaces the rule's options wholesale, so it restates the base's bans beside its own pattern.
  const base = read("oxlint.base.json") as {
    rules: Record<string, [string, { paths: unknown[]; patterns: unknown[] }]>;
    overrides: { files: string[]; rules: Record<string, [string, { paths: unknown[]; patterns: unknown[] }] | undefined> }[];
  };
  const own = base.rules["eslint/no-restricted-imports"]?.[1];
  const layers = base.overrides.filter((override) => ["src/controllers/**", "src/services/**", "src/views/**"].includes(override.files[0] ?? ""));

  it.each(layers.map((override) => [override.files[0], override] as const))(
    "restates the base's import bans in its `%s` override",
    (_files, override) => {
      const options = override.rules["eslint/no-restricted-imports"]?.[1];
      expect(options?.paths).toEqual(own?.paths ?? []);
      expect(options?.patterns.slice(0, -1)).toEqual(own?.patterns ?? []);
    },
  );

  it("declares all three layer overrides", () => {
    expect(layers).toHaveLength(3);
  });
});
