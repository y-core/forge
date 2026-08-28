import { describe, expect, it } from "bun:test";
import { findAppRoot, installedAppRoot, resolveAppRoot } from "./app-root";

describe("findAppRoot() — deriving the app root from an install path", () => {
  it("returns the directory holding node_modules", () => {
    expect(findAppRoot("/srv/app/node_modules/@y-core/forge/src/cli/app-root.ts")).toBe("/srv/app");
  });

  it("takes the first node_modules, so a nested install still names the app", () => {
    expect(findAppRoot("/srv/app/node_modules/x/node_modules/@y-core/forge/src/cli/app-root.ts")).toBe("/srv/app");
  });

  it("resolves a pnpm store path to the app rather than to the store entry", () => {
    expect(findAppRoot("/srv/app/node_modules/.pnpm/@y-core+forge@0.0.84/node_modules/@y-core/forge/src/cli/app-root.ts")).toBe("/srv/app");
  });

  it("honours backslash separators, so a Windows install resolves the same way", () => {
    expect(findAppRoot("C:\\srv\\app\\node_modules\\@y-core\\forge\\src\\cli\\app-root.ts")).toBe("C:\\srv\\app");
  });

  it("returns undefined when the path is not inside a node_modules at all", () => {
    expect(findAppRoot("/src/forge/src/cli/app-root.ts")).toBeUndefined();
  });

  it("does not match a directory that merely begins with the name", () => {
    expect(findAppRoot("/srv/node_modules_backup/app/src/cli/app-root.ts")).toBeUndefined();
  });

  it("returns the empty string for an install at the filesystem root, not undefined", () => {
    expect(findAppRoot("/node_modules/@y-core/forge/src/cli/app-root.ts")).toBe("");
  });
});

describe("installedAppRoot()", () => {
  it("is undefined while forge is being developed rather than consumed", () => {
    expect(installedAppRoot()).toBeUndefined();
  });
});

describe("resolveAppRoot()", () => {
  it("returns an explicitly stated root untouched", () => {
    expect(resolveAppRoot("/srv/app")).toBe("/srv/app");
  });

  it("prefers the explicit root over anything it could derive", () => {
    expect(resolveAppRoot("/somewhere/else")).toBe("/somewhere/else");
  });

  it("refuses rather than guessing when it can derive nothing", () => {
    expect(() => resolveAppRoot()).toThrow("Cannot determine the application root");
  });

  it("names the fix in the refusal", () => {
    expect(() => resolveAppRoot()).toThrow("Pass the root explicitly");
  });
});
