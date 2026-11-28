import { defineDbConfig } from "@y-core/forge/tooling/db/host";

export default defineDbConfig({ schemas: ["config/db/schema.sql"] });
