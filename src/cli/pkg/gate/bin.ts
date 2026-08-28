#!/usr/bin/env bun
import { execute } from "../../core/execute";
import { createGateBinCommand } from "./command";

await execute(createGateBinCommand());
