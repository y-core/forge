#!/usr/bin/env bun
import { execute } from "../../cli/execute";
import { createAssetsCommands } from "./commands";

const root = createAssetsCommands();
await execute(root);
