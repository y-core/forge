/** The gate `forge release` runs before it cuts a tag. */

import type { ReleaseCommandConfig } from "../src/tooling/release/mod";

export default { gateCommand: ["bun", "run", "verify:release"] } satisfies Omit<ReleaseCommandConfig, "cwd">;
