#!/usr/bin/env bun
import { execute } from "../core/execute";
import { createGenEnv } from "./cf-env-command";

await execute(createGenEnv());
