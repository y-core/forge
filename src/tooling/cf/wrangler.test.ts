import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseWranglerConfig } from "./config/parse";

const BUNDLE_URL = pathToFileURL(resolve(import.meta.dir, "wrangler.mjs")).href;

const JSONC_FIXTURE = `{
  // the worker's name
  "name": "fixture-worker",
  "vars": { "MODE": "test", },
  /* assets served ahead of the worker */
  "assets": {
    "directory": "./public",
    "run_worker_first": ["/api/*", "!/api/static/*",],
  },
}
`;

function writeFixture(source: string): string {
  const path = resolve(mkdtempSync(resolve(tmpdir(), "forge-wrangler-")), "wrangler.jsonc");
  writeFileSync(path, source, "utf-8");
  return path;
}

function runUnderNode(script: string): unknown {
  const child = spawnSync("node", ["--input-type=module", "-e", script], { encoding: "utf-8" });
  expect(child.stderr).toBe("");
  return JSON.parse(child.stdout ?? "");
}

function parseUnderNode(path: string): unknown {
  return runUnderNode(
    `const { parseWranglerConfig } = await import(${JSON.stringify(BUNDLE_URL)});
     try { console.log(JSON.stringify({ config: parseWranglerConfig(${JSON.stringify(path)}) })); }
     catch (thrown) { console.log(JSON.stringify({ message: thrown.message })); }`,
  );
}

function sourceMessage(path: string): string {
  try {
    parseWranglerConfig(path);
    return "";
  } catch (thrown) {
    return (thrown as Error).message;
  }
}

describe("the committed wrangler bundle under node", () => {
  it("parses a JSONC config to exactly what the source parser returns", () => {
    const path = writeFixture(JSONC_FIXTURE);

    expect(parseUnderNode(path)).toEqual({ config: parseWranglerConfig(path) });
  });

  it("rejects a malformed config with the source parser's message", () => {
    const path = writeFixture('{ "vars": {} }');

    expect(parseUnderNode(path)).toEqual({ message: sourceMessage(path) });
  });

  it("exports parseWranglerConfig and nothing else", () => {
    const names = runUnderNode(`console.log(JSON.stringify(Object.keys(await import(${JSON.stringify(BUNDLE_URL)}))));`);

    expect(names).toEqual(["parseWranglerConfig"]);
  });
});
