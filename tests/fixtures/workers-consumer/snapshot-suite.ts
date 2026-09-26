/// <reference path="../../../src/testing/node.d.ts" />

// Forge's own `tsconfig.json` checks `snapshot.ts` against the richer `.types/node.d.ts`, so only this
// program, under `"types": []`, fails on a missing or over-wide declaration in `src/testing/node.d.ts`.
import { matchTextSnapshot } from "@y-core/forge/testing/snapshot";

export const compare = (actual: string): Promise<string> =>
  matchTextSnapshot(actual, "fixtures/layout.txt", { ci: true }).then((outcome) => (outcome.ok ? outcome.data.state : outcome.error.report));
