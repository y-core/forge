#!/usr/bin/env bun
import { execute } from "../../cli/execute";
import { createReleaseBinCommand } from "./release";

await execute(createReleaseBinCommand());
