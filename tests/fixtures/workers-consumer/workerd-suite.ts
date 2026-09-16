/// <reference path="../../../src/testing/node.d.ts" />
// The test-side half of the `"types": []` contract: a workerd suite reaches the dev-server helper,
// whose node dependence arrives through this one file-scoped reference rather than a `types` entry.
// A consumer writes `/// <reference types="@y-core/forge/testing/node" />`; here the path form is
// what resolves, because this fixture reaches forge through `paths` and a type reference directive
// is resolved against `node_modules`, never against `paths`.
import { startDevServer } from "@y-core/forge/testing/workerd";

export const start = (): Promise<{ origin: string }> => startDevServer({ config: "wrangler.jsonc" });
