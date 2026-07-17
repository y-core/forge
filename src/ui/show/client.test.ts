import { describe, expect, it } from "bun:test";
import { resumeScope } from "../client/resume";
// Side-effect import: registers the "show-filter" scope on the shared resume registry.
import "./client";

/**
 * Builds a minimal `[data-scope]` stand-in. The `show-filter` setup only reaches for
 * `querySelectorAll("[data-filter-item]")` and `querySelector("[data-ref='count']")`,
 * so a light fake avoids pulling in a full DOM.
 */
function fakeScopeRoot(state: string): HTMLElement {
  return {
    dataset: { scope: "show-filter", state },
    querySelectorAll: () => [] as unknown as NodeListOf<HTMLElement>,
    querySelector: () => null,
  } as unknown as HTMLElement;
}

describe("show client scope registration", () => {
  it("registers the 'show-filter' scope so it can be resumed", () => {
    const state = resumeScope(fakeScopeRoot('{"query":""}'));
    expect(state).toBeDefined();
    // Serialized state is rehydrated into a signal keyed by "query".
    expect(state?.query).toBeDefined();
  });

  it("returns undefined for an unregistered scope name", () => {
    const root = {
      dataset: { scope: "not-registered" },
      querySelectorAll: () => [] as unknown as NodeListOf<HTMLElement>,
      querySelector: () => null,
    } as unknown as HTMLElement;
    expect(resumeScope(root)).toBeUndefined();
  });
});
