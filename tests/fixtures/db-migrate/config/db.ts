// A consumer of forge: it names forge's own `src/auth/schema.sql` on purpose, composes it into a
// migration of its own, and applies that. Nothing is discovered — an installed package contributes
// no DDL unless it is named here.
import type { DbHostConfig } from "@y-core/forge/tooling/db";

export default { schemas: ["../../../src/auth/schema.sql"] } satisfies DbHostConfig;
