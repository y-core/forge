import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkExposure } from "./exposure";

let root: string;

function writeWorkerConfig(body: string): void {
  writeFileSync(join(root, "wrangler.jsonc"), `{\n  // a comment, so the JSONC path is exercised\n${body}\n}\n`);
}

const run = () => checkExposure({ root, workerConfig: "wrangler.jsonc" });
const strict = () => checkExposure({ root, workerConfig: "wrangler.jsonc", require: "unroutable" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forge-exposure-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkExposure", () => {
  it("passes when all three keys are stated", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": [{ "pattern": "example.com", "custom_domain": true }]');
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("deployment exposure: 3/3 keys stated");
  });

  it("passes on a stated exposure, since the check reads intent rather than a value", async () => {
    writeWorkerConfig('  "workers_dev": true,\n  "preview_urls": true,\n  "routes": []');
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("fails naming an unstated workers_dev", async () => {
    writeWorkerConfig('  "preview_urls": false,\n  "routes": []');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual([
      "`workers_dev` is unstated, and an unstated `workers_dev` publishes the Worker on a `workers.dev` subdomain",
    ]);
    expect(result.findings.map((f) => f.file)).toEqual(["wrangler.jsonc"]);
    expect(result.findings.map((f) => f.detail)).toEqual([
      ['state "workers_dev": false to keep it off, or "workers_dev": true to say the exposure is deliberate'],
    ]);
  });

  it("fails naming an unstated preview_urls", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "routes": []');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual([
      "`preview_urls` is unstated, and an unstated `preview_urls` publishes every uploaded version on its own preview URL",
    ]);
  });

  it("fails naming an unstated routes, and names the other spelling that would settle it", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual([
      "`routes` is unstated, and a config silent about `routes` reads identically to one whose routes were deleted by accident",
    ]);
    expect(result.findings.map((f) => f.detail)).toEqual([
      [
        'state the routes the Worker serves, or "routes": [] to say it serves none',
        "`route` states it too — wrangler accepts either spelling, but never both",
      ],
    ]);
  });

  it("fails once per unstated key, naming all three", async () => {
    writeWorkerConfig('  "name": "app"');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.length).toBe(3);
    expect(result.summary).toBe("deployment exposure: 0/3 keys stated");
  });

  it("fails when the worker config is missing rather than reporting a stated tree", async () => {
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(["`wrangler.jsonc` not found"]);
    expect(result.summary).toBe("deployment exposure: no worker config");
  });

  it("fails when the worker config does not parse", async () => {
    writeFileSync(join(root, "wrangler.jsonc"), "{ not json");
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.summary).toBe("deployment exposure: unparseable");
  });

  it("defaults the worker config path to wrangler.jsonc", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": []');
    const result = await checkExposure({ root });
    expect(result.ok).toBe(true);
  });

  it("settles the routing control on the singular route key alone", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "route": "example.com/*"');
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("deployment exposure: 3/3 keys stated");
  });

  it("fails when both routing spellings are stated, whatever their values", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": [],\n  "route": "example.com/*"');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(["`routes` and `route` are both stated, and wrangler accepts exactly one"]);
    expect(result.findings.map((f) => f.detail)).toEqual([["delete one — `routes` for a list of patterns, `route` for a single one"]]);
    expect(result.summary).toBe("deployment exposure: 2/3 keys stated");
  });

  it("fails on both spellings even when routes is non-empty", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": ["a.example.com/*"],\n  "route": "b.example.com/*"');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(["`routes` and `route` are both stated, and wrangler accepts exactly one"]);
  });

  it("emits exactly one routing finding for the contradiction under the strict posture", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": ["a.example.com/*"],\n  "route": "b.example.com/*"');
    const result = await strict();
    expect(result.findings.map((f) => f.message)).toEqual(["`routes` and `route` are both stated, and wrangler accepts exactly one"]);
  });

  it("passes the strict posture on the unroutable values", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": []');
    const result = await strict();
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("deployment exposure: 3/3 keys unroutable");
  });

  it("names a routable workers_dev under the strict posture", async () => {
    writeWorkerConfig('  "workers_dev": true,\n  "preview_urls": false,\n  "routes": []');
    const result = await strict();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(['`workers_dev` is `true`, and `require: "unroutable"` asks for `false`']);
    expect(result.findings.map((f) => f.detail)).toEqual([
      ['state "workers_dev": false, or drop `require: "unroutable"` to say the exposure is deliberate'],
    ]);
    expect(result.summary).toBe("deployment exposure: 2/3 keys unroutable");
  });

  it("names a non-empty routes under the strict posture", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": ["example.com/*"]');
    const result = await strict();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(['`routes` is `["example.com/*"]`, and `require: "unroutable"` asks for `[]`']);
  });

  it("names both routing keys under the strict posture when only the singular route is stated", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "route": "example.com/*"');
    const result = await strict();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual([
      '`routes` is absent, and `require: "unroutable"` asks for `[]`',
      '`route` is `"example.com/*"`, and `require: "unroutable"` asks for no `route` at all',
    ]);
  });

  it("reports an absent key as unstated rather than as a wrong value under the strict posture", async () => {
    writeWorkerConfig('  "preview_urls": false,\n  "routes": []');
    const result = await strict();
    expect(result.findings.map((f) => f.message)).toEqual([
      "`workers_dev` is unstated, and an unstated `workers_dev` publishes the Worker on a `workers.dev` subdomain",
    ]);
  });

  it("caps a long value so one routes array cannot own the line", async () => {
    const routes = JSON.stringify(["one.example.com/*", "two.example.com/*", "three.example.com/*"]);
    writeWorkerConfig(`  "workers_dev": false,\n  "preview_urls": false,\n  "routes": ${routes}`);
    const result = await strict();
    expect(result.findings[0]?.message).toBe(
      '`routes` is `["one.example.com/*","two.example.com/*","three…`, and `require: "unroutable"` asks for `[]`',
    );
  });

  it('require: "stated" is the default spelled out', async () => {
    writeWorkerConfig('  "workers_dev": true,\n  "preview_urls": true,\n  "routes": ["example.com/*"]');
    const result = await checkExposure({ root, workerConfig: "wrangler.jsonc", require: "stated" });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("deployment exposure: 3/3 keys stated");
  });

  it("judges a named environment as its own deployment", async () => {
    writeWorkerConfig(
      '  "workers_dev": false,\n  "preview_urls": false,\n  "routes": [],\n' +
        '  "env": { "staging": { "workers_dev": false, "preview_urls": false, "routes": [] } }',
    );
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("deployment exposure: 6/6 keys stated across 2 deployments");
  });

  it("names every key of an environment that states none, keeping the file a reader can open", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": [],\n  "env": { "dev": { "vars": { "MODE": "dev" } } }');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual([
      "`env.dev.workers_dev` is unstated, and an unstated `workers_dev` publishes the Worker on a `workers.dev` subdomain",
      "`env.dev.preview_urls` is unstated, and an unstated `preview_urls` publishes every uploaded version on its own preview URL",
      "`env.dev.routes` is unstated, and a config silent about `routes` reads identically to one whose routes were deleted by accident",
    ]);
    expect(result.findings.map((f) => f.file)).toEqual(["wrangler.jsonc", "wrangler.jsonc", "wrangler.jsonc"]);
    expect(result.summary).toBe("deployment exposure: 3/6 keys stated across 2 deployments");
  });

  it("does not model wrangler's merge — a stated top level does not settle an environment", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": [],\n  "env": { "staging": { "name": "app-staging" } }');
    const result = await run();
    expect(result.findings.length).toBe(3);
    expect(result.findings.every((f) => f.message.startsWith("`env.staging."))).toBe(true);
  });

  it("reports the top level before each environment, in declared order", async () => {
    writeWorkerConfig('  "env": { "staging": { "workers_dev": false }, "dev": {} }');
    const result = await run();
    expect(result.findings.map((f) => f.message.match(/`([^`]+)`/)?.[1])).toEqual([
      "workers_dev",
      "preview_urls",
      "routes",
      "env.staging.preview_urls",
      "env.staging.routes",
      "env.dev.workers_dev",
      "env.dev.preview_urls",
      "env.dev.routes",
    ]);
    expect(result.summary).toBe("deployment exposure: 1/9 keys stated across 3 deployments");
  });

  it("fails when env is not a table of named environments", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": [],\n  "env": "staging"');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(["`env` is not a table of named environments"]);
    expect(result.summary).toBe("deployment exposure: 3/3 keys stated");
  });

  it("fails when a named environment is not a table, counting it as holding none of its controls", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": [],\n  "env": { "dev": true }');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(["`env.dev` is not an environment table"]);
    expect(result.summary).toBe("deployment exposure: 3/6 keys stated across 2 deployments");
  });

  it("fails when the worker config does not hold a JSON object", async () => {
    writeFileSync(join(root, "wrangler.jsonc"), "[1, 2]");
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(["`wrangler.jsonc` does not hold a JSON object"]);
    expect(result.summary).toBe("deployment exposure: unreadable");
  });
});
