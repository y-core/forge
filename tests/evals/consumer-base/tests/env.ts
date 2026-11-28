import type { TestD1 } from "@y-core/forge/testing/d1/bun";

import type { Bindings } from "../src/app/types";

/** The bindings a test drives the app with: a private in-memory database and the vars `wrangler.jsonc` sets. */
export function testEnv(d1: TestD1): Bindings {
  return { DB: d1.binding as unknown as D1Database, SITE_NAME: "Forge Eval" };
}
