import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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
    expect(jsPlugins).toEqual(["../lint/plugin.mjs"]);
    expect(existsSync(resolve(import.meta.dir, "../lint/plugin.mjs"))).toBe(true);
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
