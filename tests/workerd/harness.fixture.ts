import { test as base } from "@playwright/test";

import { serveWorker } from "../../src/testing/harness";
import type { ServedWorker, ServeWorkerOptions } from "../../src/testing/harness";

/** A Playwright `test` whose worker-scoped `served` fixture is `options`' Worker, closed when the worker ends. */
export function harnessTest(options: ServeWorkerOptions) {
  return base.extend<object, { served: ServedWorker }>({
    served: [
      // oxlint-disable-next-line no-empty-pattern -- playwright reads a fixture's dependencies off this pattern, and this one has none
      async ({}, use) => {
        const served = await serveWorker(options);
        try {
          await use(served);
        } finally {
          await served.harness.close();
        }
      },
      { scope: "worker", timeout: 120_000 },
    ],
  });
}

export { expect, test } from "@playwright/test";
