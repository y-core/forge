import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";

import { gateFixtureRoot } from "./gate.fixture";
import { deployTarget, importsCondition, importTargets, readPackageImports } from "./package-imports";
import type { PackageImports } from "./types";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function manifestRoot(files: Record<string, string>): string {
  const root = gateFixtureRoot(files, "forge-imports-");
  roots.push(root);
  return root;
}

describe("readPackageImports()", () => {
  it("returns the `imports` map of the root's manifest, nested conditions intact", () => {
    const imports = { "#relax/*": { "forge-dev": "./src/relax/*.dev.ts", default: "./src/relax/*.ts" }, "#app/x": "./src/x.ts" };
    const root = manifestRoot({ "package.json": JSON.stringify({ name: "app", imports }) });

    expect(readPackageImports(root)).toEqual({
      "#relax/*": { "forge-dev": "./src/relax/*.dev.ts", default: "./src/relax/*.ts" },
      "#app/x": "./src/x.ts",
    });
  });

  const empty: { label: string; files: Record<string, string> }[] = [
    { label: "a root with no manifest", files: { "src/a.ts": "" } },
    { label: "a manifest that is not JSON", files: { "package.json": "{ imports: " } },
    { label: "a manifest that is a JSON array", files: { "package.json": "[]" } },
    { label: "a manifest declaring no `imports`", files: { "package.json": '{ "name": "app" }' } },
    { label: "an `imports` that is an array", files: { "package.json": '{ "imports": ["./src/a.ts"] }' } },
    { label: "an `imports` that is a string", files: { "package.json": '{ "imports": "./src/a.ts" }' } },
  ];

  for (const { label, files } of empty) {
    it(`returns an empty map for ${label}`, () => {
      expect(readPackageImports(manifestRoot(files))).toEqual({});
    });
  }
});

describe("importTargets() — which key a specifier matches", () => {
  const cases: { label: string; imports: PackageImports; specifier: string; expected: string[] }[] = [
    { label: "an exact key", imports: { "#app/x": "./src/x.ts" }, specifier: "#app/x", expected: ["src/x.ts"] },
    {
      label: "a `*` key, substituting the match",
      imports: { "#app/*": "./src/app/*.ts" },
      specifier: "#app/routes",
      expected: ["src/app/routes.ts"],
    },
    {
      label: "a `*` key whose match spans a slash",
      imports: { "#app/*": "./src/app/*.ts" },
      specifier: "#app/admin/routes",
      expected: ["src/app/admin/routes.ts"],
    },
    {
      label: "a `*` key with a trailer after the star",
      imports: { "#css/*.css": "./src/css/*.css" },
      specifier: "#css/theme.css",
      expected: ["src/css/theme.css"],
    },
    {
      label: "a target substituting the match at every star",
      imports: { "#feat/*": "./src/*/*.ts" },
      specifier: "#feat/mail",
      expected: ["src/mail/mail.ts"],
    },
    {
      label: "the exact key over a `*` key that also matches",
      imports: { "#app/*": "./src/app/*.ts", "#app/x": "./src/special.ts" },
      specifier: "#app/x",
      expected: ["src/special.ts"],
    },
    {
      label: "the `*` key with the longer prefix, whatever the key order",
      imports: { "#app/*": "./src/app/*.ts", "#app/admin/*": "./src/admin/*.ts" },
      specifier: "#app/admin/users",
      expected: ["src/admin/users.ts"],
    },
  ];

  for (const { label, imports, specifier, expected } of cases) {
    it(`resolves ${label}`, () => {
      expect(importTargets(imports, specifier)).toEqual(expected);
    });
  }
});

describe("importTargets() — every condition's target", () => {
  it("reads a target written as a bare string", () => {
    expect(importTargets({ "#a": "./src/a.ts" }, "#a")).toEqual(["src/a.ts"]);
  });

  it("returns every target of a flat conditions object, in the order the conditions are written", () => {
    const imports = { "#relax/cop": { "forge-dev": "./src/cop.dev.ts", workerd: "./src/cop.worker.ts", default: "./src/cop.strict.ts" } };

    expect(importTargets(imports, "#relax/cop")).toEqual(["src/cop.dev.ts", "src/cop.worker.ts", "src/cop.strict.ts"]);
  });

  it("descends into nested conditions, so an inactive branch's target is still returned", () => {
    const imports = { "#a": { node: { import: "./src/a.node.ts" }, worker: { "forge-dev": "./src/a.dev.ts", default: "./src/a.ts" } } };

    expect(importTargets(imports, "#a")).toEqual(["src/a.node.ts", "src/a.dev.ts", "src/a.ts"]);
  });

  it("returns a target named under two conditions once", () => {
    expect(importTargets({ "#a": { workerd: "./src/a.ts", default: "./src/a.ts" } }, "#a")).toEqual(["src/a.ts"]);
  });

  it("drops a target outside the repository root's `./` form", () => {
    const imports = { "#a": { node: "lodash", worker: "../sibling/a.ts", browser: "/abs/a.ts", default: "./src/a.ts" } };

    expect(importTargets(imports, "#a")).toEqual(["src/a.ts"]);
  });
});

describe("importTargets() — a specifier no key matches", () => {
  const imports: PackageImports = { "#app/*": "./src/app/*.ts", "#css/*.css": "./src/css/*.css", "#a/*/b/*": "./src/*.ts" };

  const cases: { label: string; specifier: string }[] = [
    { label: "a bare specifier", specifier: "valibot" },
    { label: "a relative specifier", specifier: "./app/routes" },
    { label: "a `#` specifier under no key", specifier: "#other/x" },
    { label: "a specifier equal to a `*` key's prefix", specifier: "#app/" },
    { label: "a specifier missing a `*` key's trailer", specifier: "#css/theme.scss" },
    { label: "a specifier shorter than a `*` key with a trailer", specifier: "#css/.css" },
    { label: "a specifier against a key carrying two stars", specifier: "#a/x/b/y" },
  ];

  for (const { label, specifier } of cases) {
    it(`returns nothing for ${label}`, () => {
      expect(importTargets(imports, specifier)).toEqual([]);
    });
  }
});

describe("deployTarget() — the first condition the deployed bundle sets, in written order", () => {
  const cases: { label: string; value: PackageImports[string]; expected: string | null }[] = [
    { label: "a bare string target", value: "./src/a.ts", expected: "src/a.ts" },
    { label: "`default` past an unset `forge-dev`", value: { "forge-dev": "./src/a.dev.ts", default: "./src/a.ts" }, expected: "src/a.ts" },
    { label: "`workerd` written before `default`", value: { workerd: "./src/a.dev.ts", default: "./src/a.ts" }, expected: "src/a.dev.ts" },
    { label: "`worker` written before `default`", value: { worker: "./src/a.worker.ts", default: "./src/a.ts" }, expected: "src/a.worker.ts" },
    { label: "`browser` written before `default`", value: { browser: "./src/a.browser.ts", default: "./src/a.ts" }, expected: "src/a.browser.ts" },
    { label: "`import` written before `default`", value: { import: "./src/a.mjs.ts", default: "./src/a.ts" }, expected: "src/a.mjs.ts" },
    { label: "`default` written before `workerd`", value: { default: "./src/a.ts", workerd: "./src/a.dev.ts" }, expected: "src/a.ts" },
    {
      label: "`default` past `node` and `require`",
      value: { node: "./src/a.node.ts", require: "./src/a.cjs", default: "./src/a.ts" },
      expected: "src/a.ts",
    },
    {
      label: "a nested `default` inside a set condition",
      value: { "forge-dev": "./src/a.dev.ts", worker: { require: "./src/a.cjs", default: "./src/a.ts" } },
      expected: "src/a.ts",
    },
    {
      label: "the next condition when a set one's nested branch resolves nothing",
      value: { worker: { node: "./src/a.node.ts" }, default: "./src/a.ts" },
      expected: "src/a.ts",
    },
    { label: "nothing when no condition is set", value: { "forge-dev": "./src/a.dev.ts", node: "./src/a.node.ts" }, expected: null },
    { label: "nothing when the set condition's target is not `./`", value: { default: "lodash" }, expected: null },
  ];

  for (const { label, value, expected } of cases) {
    it(`picks ${label}`, () => {
      expect(deployTarget({ "#a": value }, "#a")).toBe(expected);
    });
  }

  it("substitutes a `*` key's match into the deployed target", () => {
    const imports = { "#relax/*": { "forge-dev": "./src/relax/*.dev.ts", default: "./src/relax/*.strict.ts" } };

    expect(deployTarget(imports, "#relax/cop")).toBe("src/relax/cop.strict.ts");
  });

  it("returns null for a specifier no key matches", () => {
    expect(deployTarget({ "#a": "./src/a.ts" }, "#b")).toBeNull();
    expect(deployTarget({ "#a": "./src/a.ts" }, "valibot")).toBeNull();
  });
});

describe("importsCondition() — whether an entry names a condition", () => {
  const imports: PackageImports = {
    "#app/relax": { "forge-dev": "./src/app/relax.dev.ts", default: "./src/app/relax.strict.ts" },
    "#app/nested": { workerd: { "forge-dev": "./src/nested.dev.ts", default: "./src/nested.ts" } },
    "#app/plain": "./src/plain.ts",
  };

  it("finds a condition at the top of the entry", () => {
    expect(importsCondition(imports, "#app/relax", "forge-dev")).toBe(true);
  });

  it("finds a condition nested under another", () => {
    expect(importsCondition(imports, "#app/nested", "forge-dev")).toBe(true);
  });

  it("finds none in a string target, which names no condition", () => {
    expect(importsCondition(imports, "#app/plain", "forge-dev")).toBe(false);
  });

  it("finds none for a key the map does not hold", () => {
    expect(importsCondition(imports, "#app/absent", "forge-dev")).toBe(false);
  });
});
