#!/usr/bin/env bun
import { execute } from "../../core/execute";
import { createReleaseBinCommand } from "./release";

await execute(createReleaseBinCommand());
