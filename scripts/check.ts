import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execute } from "../src/cli/mod";
import { createGateCommand } from "../src/pkg/mod";
import { STEPS } from "./lib/steps";

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await execute(createGateCommand({ cwd, gate: "check", steps: STEPS }));
