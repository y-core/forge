/** The gate `forge release` runs, and that forge's tags are cut on the pushed release commit (BUILD_TOOLING §2a). */

import { defineReleaseConfig } from "../src/tooling/release/release";

export default defineReleaseConfig({ gateCommand: ["bun", "run", "verify:scheduled"], tagOn: "pushed" });
