import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { unstable_readConfig } from "wrangler";

import type { WranglerConfig } from "../types";
import { ENVIRONMENT_INHERITANCE, listDeployments, readDeployment } from "./environment";
import type { DeploymentKey, EnvironmentInheritance, ResolvedDeployment } from "./types";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function writeConfig(config: object): string {
  const root = mkdtempSync(join(tmpdir(), "forge-environment-"));
  roots.push(root);
  const path = join(root, "wrangler.json");
  writeFileSync(path, JSON.stringify(config));
  return path;
}

function readWrangler(path: string, env?: string): Record<string, unknown> {
  return unstable_readConfig({ config: path, ...(env === undefined ? {} : { env }) }, { hideWarnings: true }) as unknown as Record<string, unknown>;
}

function resolved(config: WranglerConfig, env: string | null): ResolvedDeployment {
  const read = readDeployment(config, env);
  if (!read.ok) throw new Error(`expected ${env} to resolve, got ${read.error}`);
  return read.data;
}

const FIXTURES: Record<DeploymentKey, readonly [unknown, unknown]> = {
  name: ["app", "app-own-name"],
  account_id: ["acc-top", "acc-own"],
  compatibility_date: ["2026-01-01", "2026-02-01"],
  compatibility_flags: [["flag_top"], ["flag_own"]],
  main: ["src/top.ts", "src/own.ts"],
  assets: [{ directory: "public-top" }, { directory: "public-own" }],
  workers_dev: [true, false],
  preview_urls: [true, false],
  routes: [[{ pattern: "top.example.com/*", zone_name: "example.com" }], [{ pattern: "own.example.com/*", zone_name: "example.com" }]],
  route: ["top.example.com/*", "own.example.com/*"],
  alias: [{ a: "./top" }, { a: "./own" }],
  build: [{ command: "echo top" }, { command: "echo own" }],
  rules: [[{ type: "Text", globs: ["**/*.top"] }], [{ type: "Text", globs: ["**/*.own"] }]],
  define: [{ X: "1" }, { X: "2" }],
  d1_databases: [[{ binding: "DB", database_name: "top" }], [{ binding: "DB", database_name: "own" }]],
};

function project(key: DeploymentKey, value: unknown): unknown {
  return key === "build" ? (value as { command?: unknown } | undefined)?.command : value;
}

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

function writeFixture(key: DeploymentKey): string {
  const [top, own] = FIXTURES[key];
  return writeConfig({ name: "app", [key]: top, env: { probe: {}, own: { [key]: own } } });
}

const PROBED_ENVS = [undefined, "probe", "own"] as const;

function classify(key: DeploymentKey): EnvironmentInheritance | "unread" {
  const path = writeFixture(key);
  const [atTop, atProbe, atOwn] = PROBED_ENVS.map((env) => project(key, readWrangler(path, env)[key]));
  if (atTop === undefined) return "unread";
  if (typeof atTop === "string" && atProbe === `${atTop}-probe`) return "suffixed";
  if (same(atProbe, atTop) && same(atOwn, atTop)) return "top-level";
  if (same(atProbe, atTop)) return "inherited";
  return "not-inherited";
}

describe("ENVIRONMENT_INHERITANCE — held against the installed wrangler", () => {
  it("classifies every key as wrangler's own config reader carries it into an environment", () => {
    const keys = Object.keys(FIXTURES) as DeploymentKey[];
    const classified = Object.fromEntries(keys.map((key) => [key, classify(key)]));
    expect(classified).toEqual(ENVIRONMENT_INHERITANCE);
  });

  it("reads every fixture without wrangler warning, since a warning is what starts its npm update check", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {
      throw new Error("wrangler warned");
    });
    const calls: unknown[][] = [];
    try {
      for (const key of Object.keys(FIXTURES) as DeploymentKey[]) {
        const path = writeFixture(key);
        for (const env of PROBED_ENVS) readWrangler(path, env);
      }
    } finally {
      calls.push(...warn.mock.calls);
      warn.mockRestore();
    }
    expect(calls).toEqual([]);
  });

  it("refuses an undeclared environment wherever wrangler does, an empty env table included", () => {
    const config: WranglerConfig = { name: "app", env: {} };
    expect(() => readWrangler(writeConfig(config), "ghost")).toThrow();
    expect(readDeployment(config, "ghost")).toEqual({ ok: false, error: "undeclared-environment" });
  });

  it("falls back to the top level with no env table at all, as wrangler does", () => {
    const config: WranglerConfig = { name: "app", d1_databases: [{ binding: "DB", database_name: "top" }] };
    const wrangler = readWrangler(writeConfig(config), "ghost");
    const effective = resolved(config, "ghost").effective;
    expect({ name: effective.name, d1_databases: effective.d1_databases }).toEqual({
      name: wrangler.name as string,
      d1_databases: wrangler.d1_databases as never,
    });
  });
});

describe("readDeployment", () => {
  const top: WranglerConfig = {
    name: "app",
    account_id: "acc-top",
    compatibility_date: "2026-01-01",
    alias: { a: "./top" },
    define: { X: "1" },
    vars: { GREETING: "hi" },
    env: { staging: { compatibility_date: "2026-02-01", alias: { a: "./staging" } }, named: { name: "app-named" } },
  };

  it("inherits a key the environment leaves out, and lets its own value win", () => {
    const { effective } = resolved(top, "staging");
    expect([effective.account_id, effective.compatibility_date]).toEqual(["acc-top", "2026-02-01"]);
  });

  it("leaves a non-inherited key absent when the environment does not state it", () => {
    expect("define" in resolved(top, "staging").effective).toBe(false);
  });

  it("suffixes the top level's name, and lets an environment's own name win", () => {
    expect([resolved(top, "staging").effective.name, resolved(top, "named").effective.name]).toEqual(["app-staging", "app-named"]);
  });

  it("reads alias from the top level whatever the environment states", () => {
    expect(resolved(top, "staging").effective.alias).toEqual({ a: "./top" });
  });

  it("applies none of wrangler's defaults, so an unstated flag set stays absent rather than empty", () => {
    expect("compatibility_flags" in resolved(top, "staging").effective).toBe(false);
    expect("compatibility_flags" in resolved(top, null).effective).toBe(false);
  });

  it("carries no key outside the table", () => {
    expect("vars" in resolved(top, null).effective).toBe(false);
    expect("vars" in resolved({ name: "app", vars: { GREETING: "hi" } }, "ghost").effective).toBe(false);
  });

  it("marks nothing inherited at the top level", () => {
    const deployment = resolved(top, null);
    expect([deployment.prefix, deployment.stated, [...deployment.inherited]]).toEqual(["", top, []]);
  });

  it("marks the keys an environment takes from the top level as inherited", () => {
    const deployment = resolved(top, "staging");
    expect(deployment.prefix).toBe("env.staging.");
    expect(deployment.stated).toBe(top.env?.staging as never);
    expect([...deployment.inherited].sort()).toEqual(
      [
        "account_id",
        "alias",
        "assets",
        "build",
        "compatibility_flags",
        "main",
        "name",
        "preview_urls",
        "route",
        "routes",
        "rules",
        "workers_dev",
      ].sort(),
    );
  });

  it("marks every key inherited when it falls back to the top level", () => {
    const deployment = resolved({ name: "app" }, "ghost");
    expect([deployment.stated, [...deployment.inherited].sort()]).toEqual([{}, Object.keys(ENVIRONMENT_INHERITANCE).sort()]);
  });

  for (const member of ["toString", "constructor", "hasOwnProperty"]) {
    it(`refuses the prototype member ${member} as an environment name when an env table exists`, () => {
      expect(readDeployment(top, member)).toEqual({ ok: false, error: "undeclared-environment" });
    });
  }
});

describe("listDeployments", () => {
  it("reads the top level, then each declared environment in declared order", () => {
    const config: WranglerConfig = { name: "app", env: { zeta: {}, alpha: {} } };
    expect(listDeployments(config).map((deployment) => deployment.env)).toEqual([null, "zeta", "alpha"]);
  });
});
