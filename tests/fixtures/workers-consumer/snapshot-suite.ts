/// <reference path="../../../src/testing/node.d.ts" />
// The only program that holds `src/testing/node.d.ts` to being sufficient: forge's own `tsconfig.json`
// excludes it, so `snapshot.ts` typechecks there against the far richer `.types/node.d.ts` and proves
// nothing. Under `"types": []` a missing or over-wide declaration fails here instead.
import { matchTextSnapshot } from "@y-core/forge/testing/snapshot";

export const compare = (actual: string): Promise<string> =>
  matchTextSnapshot(actual, "fixtures/layout.txt", { ci: true }).then((outcome) => (outcome.ok ? outcome.data.state : outcome.error.report));
