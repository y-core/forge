#!/usr/bin/env bun
import { execute } from "../../cli/execute";
import { makeGenEnv } from "./cf-env-command";

await execute(makeGenEnv());
