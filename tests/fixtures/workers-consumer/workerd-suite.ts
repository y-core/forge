/// <reference path="../../../src/testing/node.d.ts" />
// A consumer writes `/// <reference types="@y-core/forge/testing/node" />`; the path form is used here
// because a type reference directive resolves against `node_modules`, never the `paths` this fixture uses.
import { startDevServer } from "@y-core/forge/testing/workerd";

export const start = (): Promise<{ origin: string }> => startDevServer({ config: "wrangler.jsonc" });
