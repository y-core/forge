// Forge ships no migration, so this config exists only to give `forge db` a wrangler config to
// resolve a scratch database from when the schema check applies the published DDL.
import type { DbHostConfig } from "@y-core/forge/tooling/db";

export default { schemas: ["../../../src/auth/schema.sql"] } satisfies DbHostConfig;
