// Generated from src/testing/harness.ts by `bun run gen:bundles` — do not edit.

// src/testing/harness.ts
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createTestHarness, experimental_readRawConfig } from "wrangler";
function derivedConfig(raw, entry) {
  const { local_protocol: _protocol, ...dev } = raw.dev ?? {};
  const { dev: _dev, ...rest } = raw;
  return { ...rest, ...entry === void 0 ? {} : { main: resolve(entry) }, ...Object.keys(dev).length > 0 ? { dev } : {} };
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
  writeFileSync(derived, JSON.stringify(derivedConfig(raw, options.entry)));
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
  try {
    const { url } = await harness.listen();
    url.hostname = options.siteHost ?? "127.0.0.1";
    await harness.update(withSiteOrigin(input, url.origin));
    return { harness, origin: url.origin };
  } catch (error) {
    await harness.close();
    throw error;
  }
}
export {
  derivedConfig,
  harnessInput,
  serveWorker,
  withSiteOrigin
};
