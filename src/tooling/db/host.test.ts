import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { forgeSchema } from "./declared";

const BUNDLE_URL = pathToFileURL(resolve(import.meta.dir, "host.mjs")).href;

function runUnderNode(script: string): unknown {
  const child = spawnSync("node", ["--input-type=module", "-e", script], { encoding: "utf-8" });
  expect(child.stderr).toBe("");
  return JSON.parse(child.stdout ?? "");
}

describe("the committed tooling/db/host bundle under node", () => {
  it("exports defineDbConfig and forgeSchema and nothing else", () => {
    const names = runUnderNode(`console.log(JSON.stringify(Object.keys(await import(${JSON.stringify(BUNDLE_URL)}))));`);

    expect(names).toEqual(["defineDbConfig", "forgeSchema"]);
  });

  it("returns a db config through defineDbConfig unchanged", () => {
    const config = runUnderNode(
      `const { defineDbConfig } = await import(${JSON.stringify(BUNDLE_URL)}); console.log(JSON.stringify(defineDbConfig({ schemas: ["schema.sql"] })));`,
    );

    expect(config).toEqual({ schemas: ["schema.sql"] });
  });

  it("names a forge schema exactly as the source does", () => {
    const named = runUnderNode(
      `const { forgeSchema } = await import(${JSON.stringify(BUNDLE_URL)}); console.log(JSON.stringify(forgeSchema("auth")));`,
    );

    expect(named).toBe(forgeSchema("auth"));
  });
});
