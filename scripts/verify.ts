import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execute } from "../src/cli/mod";
import { createGateCommand } from "./lib/gate-command";

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await execute(createGateCommand({ cwd, gate: "verify" }));
