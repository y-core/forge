import { describe, expect, it } from "bun:test";
import { resumeScope } from "../client/resume";
import "./client";

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
