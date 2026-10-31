/** The gate `forge release` runs before it cuts a tag. */

import { defineReleaseConfig } from "../src/tooling/release/release";

export default defineReleaseConfig({ gateCommand: ["bun", "run", "verify:scheduled"] });
