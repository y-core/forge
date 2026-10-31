import { defineDbConfig } from "@y-core/forge/tooling/db/host";

// Forge ships no migration, so this config exists only to give `forge db` a wrangler config to
// resolve a scratch database from when the schema check applies the published DDL.
export default defineDbConfig({ schemas: ["../../../src/auth/schema.sql"] });
