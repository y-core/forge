// `bun .claude/skills/handoff/scripts/handoff.ts <task-id>[@<base>] … [--message <msg>]` — see the skill.
import process, { argv, exit } from "node:process";

import { handoffScript } from "@y-core/forge/warden";

exit(handoffScript(argv.slice(2), { cwd: process.cwd() }));
