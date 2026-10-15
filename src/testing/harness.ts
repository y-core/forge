import { rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createTestHarness, experimental_readRawConfig } from "wrangler";
import type { TestHarness, TestHarnessOptions } from "wrangler";

/** The Worker a test serves, and what it is told that its wrangler config does not say. @public */
export interface ServeWorkerOptions {
  /** Path to the `wrangler.jsonc` whose bindings and compatibility settings the Worker runs under. */
  config: string;
  /** A test-only module served in place of the config's `main`, under the same bindings. */
  entry?: string;
  /** `localhost` for a WebAuthn journey, which refuses an IP address as an RP ID; `127.0.0.1` where unset. */
  siteHost?: "127.0.0.1" | "localhost";
  secrets?: Record<string, string>;
  /** Merged over the config's own `vars`, and under `SITE_ORIGIN`, which is always the served origin. */
  vars?: Record<string, string>;
}

/** A started harness and the origin a test reaches it on. @public */
export interface ServedWorker {
  harness: TestHarness;
  origin: string;
}

type RawConfig = Record<string, unknown> & { dev?: Record<string, unknown> };

/** `raw` as the harness serves it: `main` replaced by `entry` where one is given, and over plain http. @internal */
export function derivedConfig(raw: RawConfig, entry?: string): RawConfig {
  // A test reaches the origin with a plain `fetch`, which refuses the self-signed certificate wrangler serves https on.
  const { local_protocol: _protocol, ...dev } = raw.dev ?? {};
  const { dev: _dev, ...rest } = raw;
  return { ...rest, ...(entry === undefined ? {} : { main: resolve(entry) }), ...(Object.keys(dev).length > 0 ? { dev } : {}) };
}

/** The harness input serving the config file at `configPath`, the caller's vars and secrets bound over its own. @internal */
export function harnessInput(options: ServeWorkerOptions, configPath: string): TestHarnessOptions {
  const vars = options.vars ?? {};
  return { workers: [{ configPath, ...(Object.keys(vars).length > 0 ? { vars } : {}), ...(options.secrets ? { secrets: options.secrets } : {}) }] };
}

/** `input` with `SITE_ORIGIN` set to `origin` on its primary Worker, over every other var. @internal */
export function withSiteOrigin(input: TestHarnessOptions, origin: string): TestHarnessOptions {
  const [primary, ...rest] = input.workers;
  if (primary === undefined || "config" in primary) return input;
  return { ...input, workers: [{ ...primary, vars: { ...primary.vars, SITE_ORIGIN: origin } }, ...rest] };
}

/** Starts a Worker under wrangler's `createTestHarness`, its origin known to it as `SITE_ORIGIN`, and resolves once it answers. @public */
export async function serveWorker(options: ServeWorkerOptions): Promise<ServedWorker> {
  // Beside the original, so every relative path and `.dev.vars` resolve as they do for it. Served by path rather than inline,
  // because only a path input takes vars and secrets that bind over `.dev.vars`.
  const derived = join(dirname(resolve(options.config)), `.wrangler-harness-${crypto.randomUUID()}.json`);
  const raw = experimental_readRawConfig({ config: options.config }).rawConfig as RawConfig;
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
