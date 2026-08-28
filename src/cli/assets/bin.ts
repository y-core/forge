#!/usr/bin/env bun
import { execute } from "../core/execute";
import { createAssetsCommands } from "./commands";

const root = createAssetsCommands();
await execute(root);
