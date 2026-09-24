#!/usr/bin/env bun
import { execute } from "../cli/execute";
import { createRootCommand } from "./root";

await execute(await createRootCommand());
