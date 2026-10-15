import { dirname, resolve } from "node:path";

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

type RawConfig = Record<string, unknown> & { vars?: Record<string, unknown> };

/** The harness input `options` serve; `raw` is the config file's own contents, read only when `entry` replaces its `main`. @internal */
export function harnessInput(options: ServeWorkerOptions, raw: RawConfig | null): TestHarnessOptions {
  const vars = options.vars ?? {};
  if (options.entry === undefined || raw === null) {
    return {
      workers: [
        { configPath: options.config, ...(Object.keys(vars).length > 0 ? { vars } : {}), ...(options.secrets ? { secrets: options.secrets } : {}) },
      ],
    };
  }
  const root = dirname(resolve(options.config));
  const { env: _env, ...inline } = raw;
  return { root, workers: [{ config: { ...inline, main: resolve(options.entry), vars: { ...raw.vars, ...vars, ...options.secrets } } }] };
}

/** `input` with `SITE_ORIGIN` set to `origin` on its primary Worker, over every other var. @internal */
export function withSiteOrigin(input: TestHarnessOptions, origin: string): TestHarnessOptions {
  const [primary, ...rest] = input.workers;
  if (primary === undefined) return input;
  const site =
    "config" in primary
      ? { config: { ...primary.config, vars: { ...primary.config.vars, SITE_ORIGIN: origin } } }
      : { ...primary, vars: { ...primary.vars, SITE_ORIGIN: origin } };
  return { ...input, workers: [site, ...rest] };
}

/** Starts a Worker under wrangler's `createTestHarness`, its origin known to it as `SITE_ORIGIN`, and resolves once it answers. @public */
export async function serveWorker(options: ServeWorkerOptions): Promise<ServedWorker> {
  const raw = options.entry === undefined ? null : (experimental_readRawConfig({ config: options.config }).rawConfig as RawConfig);
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
