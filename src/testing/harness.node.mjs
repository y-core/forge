// Generated from src/testing/harness.ts by `bun run gen:bundles` — do not edit.

// src/testing/harness.ts
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { createTestHarness, experimental_readRawConfig } from "wrangler";

// src/tooling/cf/dev/conditions.ts
var WRANGLER_CONDITIONS = ["workerd", "worker", "browser"];
var DEV_CONDITION = "forge-dev";
function appendForgeDev(current) {
  const listed = current === void 0 ? [...WRANGLER_CONDITIONS] : current.split(",").map((condition) => condition.trim());
  const kept = listed.filter((condition) => condition.length > 0 && condition !== DEV_CONDITION);
  return [...kept, DEV_CONDITION].join(",");
}

// src/testing/harness.ts
function derivedConfig(raw, entry, armed = false) {
  const { local_protocol: _protocol, ...dev } = raw.dev ?? {};
  const { dev: _dev, ...rest } = raw;
  return {
    ...rest,
    ...entry === void 0 ? {} : { main: resolve(entry) },
    ...armed ? { define: { ...raw.define, __FORGE_DEV__: "true" } } : {},
    ...Object.keys(dev).length > 0 ? { dev } : {}
  };
}
async function withDevConditions(start) {
  const previous = process.env.WRANGLER_BUILD_CONDITIONS;
  process.env.WRANGLER_BUILD_CONDITIONS = appendForgeDev(previous);
  try {
    return await start();
  } finally {
    if (previous === void 0) delete process.env.WRANGLER_BUILD_CONDITIONS;
    else process.env.WRANGLER_BUILD_CONDITIONS = previous;
  }
}
var startQueue = Promise.resolve();
function queueStart(start) {
  const run = startQueue.then(start, start);
  startQueue = run.catch(() => void 0);
  return run;
}
function harnessInput(options, configPath) {
  const vars = options.vars ?? {};
  return { workers: [{ configPath, ...Object.keys(vars).length > 0 ? { vars } : {}, ...options.secrets ? { secrets: options.secrets } : {} }] };
}
function withSiteOrigin(input, origin) {
  const [primary, ...rest] = input.workers;
  if (primary === void 0 || "config" in primary) return input;
  return { ...input, workers: [{ ...primary, vars: { ...primary.vars, SITE_ORIGIN: origin } }, ...rest] };
}
async function serveWorker(options) {
  const derived = join(dirname(resolve(options.config)), `.wrangler-harness-${crypto.randomUUID()}.json`);
  const raw = experimental_readRawConfig({ config: options.config }).rawConfig;
  writeFileSync(derived, JSON.stringify(derivedConfig(raw, options.entry, options.dev === true)));
  const input = harnessInput(options, derived);
  const harness = createTestHarness(input);
  const close = harness.close.bind(harness);
  harness.close = async () => {
    try {
      await close();
    } finally {
      rmSync(derived, { force: true });
    }
  };
  const start = async () => {
    const { url } = await harness.listen();
    url.hostname = options.siteHost ?? "127.0.0.1";
    await harness.update(withSiteOrigin(input, url.origin));
    return url.origin;
  };
  try {
    return { harness, origin: await queueStart(options.dev === true ? () => withDevConditions(start) : start) };
  } catch (error) {
    await harness.close();
    throw error;
  }
}
export {
  derivedConfig,
  harnessInput,
  queueStart,
  serveWorker,
  withDevConditions,
  withSiteOrigin
};
