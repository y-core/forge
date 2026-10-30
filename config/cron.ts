/** The table `verify:cron` runs: what no gate row runs, for task-forge's cron or a run by hand. */

import { crossEngineStep } from "../src/tooling/gate/mod";
import type { Step } from "../src/tooling/gate/mod";

export default [crossEngineStep()] satisfies readonly Step[];
