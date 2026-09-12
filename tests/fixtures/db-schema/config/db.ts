// Forge is a library: it declares `src/auth/schema.sql` and ships no migration. This fixture exists
// because `forge db` needs a wrangler config to resolve a scratch database from, and the schema
// check is the one gate row that holds the published DDL to what a real SQLite makes of it.
import type { DbHostConfig } from "@y-core/forge/tooling/db";

export default { schemas: ["../../../src/auth/schema.sql"] } satisfies DbHostConfig;
