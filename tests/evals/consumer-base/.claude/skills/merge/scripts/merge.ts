// `bun .claude/skills/merge/scripts/merge.ts merge <id>=<sha> …` or `… push [--message <msg>] [--ids a,b] [--full] [--checked <sha>]` — see the skill.
import process, { argv, exit } from "node:process";

import { mergeScript } from "@y-core/forge/warden";

exit(mergeScript(argv.slice(2), { cwd: process.cwd() }));
