import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkExposure } from "./exposure";

let root: string;

function writeWorkerConfig(body: string): void {
  writeFileSync(join(root, "wrangler.jsonc"), `{\n  // a comment, so the JSONC path is exercised\n  "name": "app",\n${body}\n}\n`);
}

const run = () => checkExposure({ root, workerConfig: "wrangler.jsonc" });
const strict = () => checkExposure({ root, workerConfig: "wrangler.jsonc", require: "unroutable" });

async function expectRefusedAt(path: string): Promise<void> {
  const result = await run();
  expect([result.ok, result.summary, result.findings.length]).toEqual([false, "deployment exposure: unparseable", 1]);
  const message = result.findings[0]?.message ?? "";
  expect(message.startsWith(`\`wrangler.jsonc\` is not parseable: malformed wrangler config at ${join(root, "wrangler.jsonc")}: ${path}: `)).toBe(
    true,
  );
}

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

  it("fails as unparseable when the worker config names no Worker", async () => {
    writeFileSync(join(root, "wrangler.jsonc"), '{ "workers_dev": false, "preview_urls": false }');
    const result = await run();
    expect([result.ok, result.summary, result.findings.length]).toEqual([false, "deployment exposure: unparseable", 1]);
    expect(
      result.findings[0]?.message.startsWith(
        `\`wrangler.jsonc\` is not parseable: malformed wrangler config at ${join(root, "wrangler.jsonc")}: name:`,
      ),
    ).toBe(true);
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

  it("an environment stating none of the keys inherits the top level's", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": [],\n  "env": { "dev": { "vars": { "MODE": "dev" } } }');
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("deployment exposure: 6/6 keys stated across 2 deployments");
  });

  it("a stated top level settles an environment that restates nothing", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": [],\n  "env": { "staging": { "name": "app-staging" } }');
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("deployment exposure: 6/6 keys stated across 2 deployments");
  });

  it("reports an unstated top level once, however many environments inherit it", async () => {
    writeWorkerConfig('  "env": { "staging": { "workers_dev": false }, "dev": {} }');
    const result = await run();
    expect(result.findings.map((f) => f.message.match(/`([^`]+)`/)?.[1])).toEqual(["workers_dev", "preview_urls", "routes"]);
    expect(result.summary).toBe("deployment exposure: 1/9 keys stated across 3 deployments");
  });

  it('reports a routable top level once under `require: "unroutable"`, not again for an environment inheriting it', async () => {
    writeWorkerConfig('  "workers_dev": true,\n  "preview_urls": false,\n  "routes": [],\n  "env": { "staging": {} }');
    const result = await strict();
    expect(result.findings.map((f) => f.message)).toEqual(['`workers_dev` is `true`, and `require: "unroutable"` asks for `false`']);
    expect(result.summary).toBe("deployment exposure: 4/6 keys unroutable across 2 deployments");
  });

  for (const { stated, inherits, top, own } of [
    { stated: "route", inherits: "routes", top: '"routes": ["example.com/*"]', own: '"route": "staging.example.com/*"' },
    { stated: "routes", inherits: "route", top: '"route": "example.com/*"', own: '"routes": ["staging.example.com/*"]' },
  ]) {
    it(`judges the routing conflict on the block as written, passing an environment's own \`${stated}\` beside an inherited \`${inherits}\``, async () => {
      writeWorkerConfig(`  "workers_dev": false,\n  "preview_urls": false,\n  ${top},\n  "env": { "staging": { ${own} } }`);
      const result = await run();
      expect([result.ok, result.findings, result.summary]).toEqual([true, [], "deployment exposure: 6/6 keys stated across 2 deployments"]);
    });
  }

  it("judges an environment's own `route` without a conflict against the `routes` it inherits", async () => {
    writeWorkerConfig(
      '  "workers_dev": false,\n  "preview_urls": false,\n  "routes": ["example.com/*"],\n  "env": { "staging": { "route": "staging.example.com/*" } }',
    );
    const result = await strict();
    expect(result.findings.map((f) => f.message).filter((message) => message.startsWith("`env.staging."))).toEqual([
      '`env.staging.route` is `"staging.example.com/*"`, and `require: "unroutable"` asks for no `route` at all',
    ]);
  });

  it("still reports the conflict when an environment states both `route` and `routes` itself", async () => {
    writeWorkerConfig(
      '  "workers_dev": false,\n  "preview_urls": false,\n  "routes": [],\n  "env": { "staging": { "route": "staging.example.com/*", "routes": [] } }',
    );
    const result = await strict();
    expect(result.findings.map((f) => f.message)).toEqual([
      "`env.staging.routes` and `env.staging.route` are both stated, and wrangler accepts exactly one",
    ]);
    expect(result.findings.map((f) => f.file)).toEqual(["wrangler.jsonc"]);
  });

  it('passes an environment\'s own `workers_dev: false` under `require: "unroutable"` beneath a top level that sets it true', async () => {
    writeWorkerConfig('  "workers_dev": true,\n  "preview_urls": false,\n  "routes": [],\n  "env": { "staging": { "workers_dev": false } }');
    const result = await strict();
    expect(result.findings.map((f) => f.message.match(/`([^`]+)`/)?.[1])).toEqual(["workers_dev"]);
    expect(result.summary).toBe("deployment exposure: 5/6 keys unroutable across 2 deployments");
  });

  it("fails as unparseable when env is not a table of named environments", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": [],\n  "env": "staging"');
    await expectRefusedAt("env");
  });

  it("fails as unparseable when a named environment is not a table", async () => {
    writeWorkerConfig('  "workers_dev": false,\n  "preview_urls": false,\n  "routes": [],\n  "env": { "dev": true }');
    await expectRefusedAt("env.dev");
  });

  it("fails as unparseable when the worker config does not hold a JSON object", async () => {
    writeFileSync(join(root, "wrangler.jsonc"), "[1, 2]");
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.summary).toBe("deployment exposure: unparseable");
  });
});
