#!/usr/bin/env bun
import { execute } from "../../src/tooling/cli/execute";
import { createWardenCommands } from "./cli/commands";

await execute(createWardenCommands());
