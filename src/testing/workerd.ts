import { DEV_SERVER_ATTEMPT_TIMEOUT_MS, spawnDevServer } from "./dev-server-start";

/** What `startDevServer` needs to know about the fixture it serves. @public */
export interface DevServerOptions {
  /** Worker entry, positional to `wrangler dev` — overrides the config's `main`. */
  entry?: string;
  /** A `wrangler.jsonc` to run under, passed as `--config`. */
  config?: string;
  /** Written to a temp env file, replacing `.dev.vars` discovery. */
  vars?: Record<string, string>;
  /** Path the readiness probe fetches; any answer counts, a 404 included. Defaults to `/`. */
  readyPath?: string;
  /** Pipe stdout and stderr into `logs()` instead of discarding them. */
  capture?: boolean;
}

/** A `wrangler dev` process, the origins it answers on, and what it printed. @public */
export interface DevServer {
  origin: string;
  siteOrigin: string;
  logs(): string;
  stop(): void;
}

/** Starts `wrangler dev` over a fixture and resolves once it answers. @public */
export function startDevServer(options: DevServerOptions = {}): Promise<DevServer> {
  return spawnDevServer(options, { attemptTimeoutMs: DEV_SERVER_ATTEMPT_TIMEOUT_MS });
}
