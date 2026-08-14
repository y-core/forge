#!/usr/bin/env bun
import { execute } from "../../cli/execute";
import { createGateBinCommand } from "./command";

await execute(createGateBinCommand());
