#!/usr/bin/env bun
import { execute } from "../../cli/execute";
import { createEvalCommand } from "./commands";

await execute(createEvalCommand());
