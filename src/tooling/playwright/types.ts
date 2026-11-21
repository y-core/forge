import type { PlaywrightTestOptions, PlaywrightWorkerOptions, Project } from "@playwright/test";

/** The environment the Playwright servers are named by; `process.env` satisfies it. @public */
export type PlaywrightEnv = Readonly<Record<string, string | undefined>>;

/** The connection a Firefox or WebKit project makes to the compat server, restating what `PW_TEST_CONNECT_*` sets for the primary. @public */
export interface CompatConnect {
  readonly wsEndpoint: string;
  readonly exposeNetwork?: string;
  readonly headers?: Record<string, string>;
}

/** What `playwrightServers` reads off the environment. @public */
export interface PlaywrightServers {
  /** The primary server's `--max-clients`, which a config sharing no dev server takes as its `workers`. */
  readonly maxClients: number;
  /** The compat server's connection, or `undefined` when `PLAYWRIGHT_COMPAT_WS_ENDPOINT` is unset or empty. */
  readonly compat: CompatConnect | undefined;
}

/** A project carrying Playwright's built-in test and worker options, which is what `defineConfig`'s `projects` takes. @public */
export type BrowserProject = Project<PlaywrightTestOptions, PlaywrightWorkerOptions>;

/** A project's `use` block. @public */
export type ProjectUse = NonNullable<BrowserProject["use"]>;

/** Project-level fields a caller adds to a helper's project — `testDir`, `testMatch`, `dependencies` and the like. @public */
export type ProjectFields = Omit<BrowserProject, "name" | "use">;
