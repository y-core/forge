import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execute } from "../src/cli/mod";
import { createReleaseCommand } from "../src/pkg/mod";

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await execute(createReleaseCommand({ cwd, stageFiles: ["package.json", "package-lock.json"] }));
