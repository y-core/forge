// Generated from src/testing/harness.ts by `bun run gen:bundles` — do not edit.

// src/testing/harness.ts
import { dirname, resolve } from "node:path";
import { createTestHarness, experimental_readRawConfig } from "wrangler";
function harnessInput(options, raw) {
  const vars = options.vars ?? {};
  if (options.entry === void 0 || raw === null) {
    return {
      workers: [
        { configPath: options.config, ...Object.keys(vars).length > 0 ? { vars } : {}, ...options.secrets ? { secrets: options.secrets } : {} }
      ]
    };
  }
  const root = dirname(resolve(options.config));
  const { env: _env, ...inline } = raw;
  return { root, workers: [{ config: { ...inline, main: resolve(options.entry), vars: { ...raw.vars, ...vars, ...options.secrets } } }] };
}
function withSiteOrigin(input, origin) {
  const [primary, ...rest] = input.workers;
  if (primary === void 0) return input;
  const site = "config" in primary ? { config: { ...primary.config, vars: { ...primary.config.vars, SITE_ORIGIN: origin } } } : { ...primary, vars: { ...primary.vars, SITE_ORIGIN: origin } };
  return { ...input, workers: [site, ...rest] };
}
async function serveWorker(options) {
  const raw = options.entry === void 0 ? null : experimental_readRawConfig({ config: options.config }).rawConfig;
  const input = harnessInput(options, raw);
  const harness = createTestHarness(input);
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
  harnessInput,
  serveWorker,
  withSiteOrigin
};
