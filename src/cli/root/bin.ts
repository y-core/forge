#!/usr/bin/env bun
import { execute } from "../core/execute";
import { createRootCommand } from "./root";

await execute(await createRootCommand());
