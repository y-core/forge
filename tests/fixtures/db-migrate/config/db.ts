// An installed package contributes no DDL unless it is named here, so a consumer lists forge's
// `src/auth/schema.sql` explicitly.
import type { DbHostConfig } from "@y-core/forge/tooling/db";

export default { schemas: ["../../../src/auth/schema.sql"] } satisfies DbHostConfig;
