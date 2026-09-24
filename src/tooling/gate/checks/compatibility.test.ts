import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkCompatibility } from "./compatibility";

let root: string;

const POSTURE = '  "compatibility_flags": ["no_nodejs_compat", "no_nodejs_compat_v2", "new_module_registry"]';

function writeWorkerConfig(body: string): void {
  writeFileSync(join(root, "wrangler.jsonc"), `{\n  // a comment, so the JSONC path is exercised\n${body}\n}\n`);
}

const run = () => checkCompatibility({ root, workerConfig: "wrangler.jsonc" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forge-compatibility-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkCompatibility", () => {
  it("passes on the posture every forge app inherits", async () => {
    writeWorkerConfig(POSTURE);
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("compatibility flags: 3/3 required stated");
  });

  it("passes on a superset, because the check asks for at least the required flags", async () => {
    writeWorkerConfig('  "compatibility_flags": ["new_module_registry", "no_nodejs_compat_v2", "no_nodejs_compat", "streaming_tail_worker"]');
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("compatibility flags: 3/3 required stated");
  });

  it("fails naming an unstated flag set", async () => {
    writeWorkerConfig('  "compatibility_date": "2026-09-11"');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual([
      "`compatibility_flags` is unstated, and an unstated flag set leaves the Worker on whatever its compatibility date defaults to",
    ]);
    expect(result.findings.map((f) => f.file)).toEqual(["wrangler.jsonc"]);
    expect(result.findings.map((f) => f.detail)).toEqual([
      ['state "compatibility_flags": ["no_nodejs_compat", "no_nodejs_compat_v2", "new_module_registry"]'],
    ]);
    expect(result.summary).toBe("compatibility flags: 0/3 required stated");
  });

  it("fails once per omitted flag, naming each", async () => {
    writeWorkerConfig('  "compatibility_flags": ["no_nodejs_compat"]');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual([
      "`compatibility_flags` omits `no_nodejs_compat_v2`",
      "`compatibility_flags` omits `new_module_registry`",
    ]);
    expect(result.findings[0]?.detail).toEqual([
      'add "no_nodejs_compat_v2" — the check asks for at least "no_nodejs_compat", "no_nodejs_compat_v2", "new_module_registry"',
    ]);
    expect(result.summary).toBe("compatibility flags: 1/3 required stated");
  });

  it("names the contradiction rather than the omission when the opposite flag is stated", async () => {
    writeWorkerConfig('  "compatibility_flags": ["nodejs_compat", "no_nodejs_compat_v2", "new_module_registry"]');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual([
      "`compatibility_flags` states `nodejs_compat`, which contradicts the required `no_nodejs_compat`",
    ]);
    expect(result.findings.map((f) => f.detail)).toEqual([
      ['delete "nodejs_compat" — a forge app runs the pure Workers/V8 surface, and a Node built-in is refused rather than shimmed'],
    ]);
  });

  it("names a contradiction even when the required flag sits beside it, since workerd cannot honour both", async () => {
    writeWorkerConfig('  "compatibility_flags": ["nodejs_compat", "no_nodejs_compat", "no_nodejs_compat_v2", "new_module_registry"]');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual([
      "`compatibility_flags` states `nodejs_compat`, which contradicts the required `no_nodejs_compat`",
    ]);
  });

  it("fails when the flag set is not a list of names", async () => {
    writeWorkerConfig('  "compatibility_flags": "no_nodejs_compat"');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(["`compatibility_flags` is not a list of flag names"]);
  });

  it("fails when the list holds something that is not a flag name", async () => {
    writeWorkerConfig('  "compatibility_flags": ["no_nodejs_compat", 7]');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(["`compatibility_flags` is not a list of flag names"]);
  });

  it("takes the required set from `require`, and refuses the opposite of each `no_*` entry", async () => {
    writeWorkerConfig('  "compatibility_flags": ["nodejs_compat"]');
    const result = await checkCompatibility({ root, workerConfig: "wrangler.jsonc", require: ["no_nodejs_compat"] });
    expect(result.findings.map((f) => f.message)).toEqual([
      "`compatibility_flags` states `nodejs_compat`, which contradicts the required `no_nodejs_compat`",
    ]);
    expect(result.summary).toBe("compatibility flags: 0/1 required stated");
  });

  it("holds a required flag that names no opposite to statedness alone", async () => {
    writeWorkerConfig('  "compatibility_flags": ["new_module_registry"]');
    const result = await checkCompatibility({ root, workerConfig: "wrangler.jsonc", require: ["new_module_registry"] });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("compatibility flags: 1/1 required stated");
  });

  it("leaves an environment silent about the flags to the top level it inherits", async () => {
    writeWorkerConfig(`${POSTURE},\n  "env": { "dev": { "vars": { "MODE": "dev" } } }`);
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("compatibility flags: 3/3 required stated");
  });

  it("judges an environment that states its own set, because wrangler replaces the list rather than merging it", async () => {
    writeWorkerConfig(`${POSTURE},\n  "env": { "dev": { "compatibility_flags": ["new_module_registry"] } }`);
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual([
      "`env.dev.compatibility_flags` omits `no_nodejs_compat`",
      "`env.dev.compatibility_flags` omits `no_nodejs_compat_v2`",
    ]);
    expect(result.summary).toBe("compatibility flags: 4/6 required stated across 2 deployments");
  });

  it("passes an environment that restates the whole posture", async () => {
    writeWorkerConfig(`${POSTURE},\n  "env": { "dev": {${POSTURE} } }`);
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("compatibility flags: 6/6 required stated across 2 deployments");
  });

  it("reports the top level before each environment, in declared order", async () => {
    writeWorkerConfig(
      '  "compatibility_flags": [],\n  "env": { "staging": { "compatibility_flags": ["no_nodejs_compat"] }, "dev": { "compatibility_flags": [] } }',
    );
    const result = await run();
    expect(result.findings.map((f) => f.message.match(/`([^`]+)`/)?.[1])).toEqual([
      "compatibility_flags",
      "compatibility_flags",
      "compatibility_flags",
      "env.staging.compatibility_flags",
      "env.staging.compatibility_flags",
      "env.dev.compatibility_flags",
      "env.dev.compatibility_flags",
      "env.dev.compatibility_flags",
    ]);
    expect(result.summary).toBe("compatibility flags: 1/9 required stated across 3 deployments");
  });

  it("fails when env is not a table of named environments", async () => {
    writeWorkerConfig(`${POSTURE},\n  "env": "staging"`);
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(["`env` is not a table of named environments"]);
  });

  it("fails when a named environment is not a table", async () => {
    writeWorkerConfig(`${POSTURE},\n  "env": { "dev": true }`);
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(["`env.dev` is not an environment table"]);
  });

  it("fails when the worker config is missing rather than reporting a stated tree", async () => {
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(["`wrangler.jsonc` not found"]);
    expect(result.summary).toBe("compatibility flags: no worker config");
  });

  it("fails when the worker config does not parse", async () => {
    writeFileSync(join(root, "wrangler.jsonc"), "{ not json");
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.summary).toBe("compatibility flags: unparseable");
  });

  it("fails when the worker config does not hold a JSON object", async () => {
    writeFileSync(join(root, "wrangler.jsonc"), "[1, 2]");
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.message)).toEqual(["`wrangler.jsonc` does not hold a JSON object"]);
    expect(result.summary).toBe("compatibility flags: unreadable");
  });

  it("defaults the worker config path to wrangler.jsonc", async () => {
    writeWorkerConfig(POSTURE);
    const result = await checkCompatibility({ root });
    expect(result.ok).toBe(true);
  });
});
