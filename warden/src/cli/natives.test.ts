import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { bindings, declaredVersion, executables, installedVersion } from "./natives";

function tree(files: Record<string, string>, prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
  }
  return root;
}

describe("bindings()", () => {
  it("spells each family's platform suffix the way that family does", () => {
    expect(bindings("darwin-arm64")).toEqual([
      { parent: "oxlint", pkg: "@oxlint/binding-darwin-arm64" },
      { parent: "oxfmt", pkg: "@oxfmt/binding-darwin-arm64" },
      { parent: "oxlint-tsgolint", pkg: "@oxlint-tsgolint/darwin-arm64" },
      { parent: "typescript", pkg: "@typescript/typescript-darwin-arm64" },
    ]);
  });
});

describe("executables()", () => {
  it("names only the two that are spawned as processes", () => {
    expect(executables("linux-x64")).toEqual([
      "node_modules/@typescript/typescript-linux-x64/lib/tsc",
      "node_modules/@oxlint-tsgolint/linux-x64/tsgolint",
    ]);
  });
});

describe("declaredVersion()", () => {
  it("strips the range prefix from a dependency or a devDependency", () => {
    const root = tree({ "package.json": '{"dependencies":{"oxlint":"^1.2.3"},"devDependencies":{"oxfmt":"~4.5.6"}}' }, "warden-declared-");

    expect(declaredVersion(root, "oxlint")).toBe("1.2.3");
    expect(declaredVersion(root, "oxfmt")).toBe("4.5.6");
  });

  it("returns null for a package the repository does not declare", () => {
    const root = tree({ "package.json": "{}" }, "warden-undeclared-");

    expect(declaredVersion(root, "oxlint")).toBeNull();
  });

  it("refuses a directory that is not a repository root", () => {
    expect(() => declaredVersion(mkdtempSync(join(tmpdir(), "warden-noroot-")), "oxlint")).toThrow("run this from a repository root");
  });
});

describe("installedVersion()", () => {
  it("reads the version out of an unpacked package", () => {
    const root = tree({ "package.json": '{"version":"1.2.3"}' }, "warden-installed-");

    expect(installedVersion(root)).toBe("1.2.3");
  });

  it("returns null for an absent directory and for a manifest it cannot parse", () => {
    const broken = tree({ "package.json": "{not json" }, "warden-broken-");

    expect(installedVersion(join(tmpdir(), "warden-absent-package"))).toBeNull();
    expect(installedVersion(broken)).toBeNull();
  });
});
