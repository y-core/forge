#!/usr/bin/env bun
import { stdin } from "bun";

import { v } from "../../../validation/mod";
import { defaultSessionDeps, driveSession } from "./session";

const RequestSchema = v.object({
  argv: v.pipe(v.array(v.string()), v.minLength(1)),
  tree: v.string(),
  sessionId: v.string(),
  projectsDir: v.string(),
  claudeJson: v.string(),
  codeMode: v.boolean(),
  timeoutMs: v.number(),
  screenLog: v.string(),
});

const decoder = new TextDecoder();
let input = "";
for await (const chunk of stdin.stream()) input += decoder.decode(chunk, { stream: true });
const request = v.parse(RequestSchema, JSON.parse(input + decoder.decode()));
process.stdout.write(JSON.stringify(await driveSession(request, defaultSessionDeps())) + "\n");
