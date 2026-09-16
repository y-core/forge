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

  it("fails naming an unstated routes", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual([
      "`routes` is unstated, and a config silent about `routes` reads identically to one whose routes were deleted by accident",
    ]);
    expect(result.findings.map((f) => f.detail)).toEqual([['state the routes the Worker serves, or "routes": [] to say it serves none']]);
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
});
