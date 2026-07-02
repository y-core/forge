#!/usr/bin/env bun
import { execute } from "../../cli/execute";
import { createGenEnv } from "./cf-env-command";

await execute(createGenEnv());
